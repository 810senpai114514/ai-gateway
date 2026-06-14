import { describe, expect, it } from 'vitest';
import type { GatewayConfig, ProviderConfig } from '../types';
import { applyHealthAwareRouting, type HealthAwareProviderRoute } from './health-routing';

describe('applyHealthAwareRouting', () => {
  it('skips unavailable providers when a usable alternative exists', () => {
    const openai = createProviderConfig('openai-main', 'openai_responses', {
      status: 'down',
      available: false
    });
    const anthropic = createProviderConfig('anthropic-main', 'anthropic_messages', {
      status: 'healthy',
      available: true
    });

    const routes = applyHealthAwareRouting(
      [
        { provider: 'openai', providerConfig: openai },
        { provider: 'anthropic', providerConfig: anthropic }
      ],
      createConfig([openai, anthropic])
    );

    expect(routes.map(formatRoute)).toEqual(['anthropic-main']);
  });

  it('keeps explicit candidates when every provider is unavailable', () => {
    const openai = createProviderConfig('openai-main', 'openai_responses', {
      status: 'down',
      available: false
    });
    const anthropic = createProviderConfig('anthropic-main', 'anthropic_messages', {
      status: 'down',
      available: false
    });

    const routes = applyHealthAwareRouting(
      [
        { provider: 'openai', providerConfig: openai },
        { provider: 'anthropic', providerConfig: anthropic }
      ],
      createConfig([openai, anthropic])
    );

    expect(routes.map(formatRoute)).toEqual(['openai-main', 'anthropic-main']);
  });

  it('prefers healthier and lower-latency providers', () => {
    const slowHealthy = createProviderConfig('slow-openai', 'openai_responses', {
      status: 'healthy',
      available: true,
      latencyMs: 300
    });
    const fastHealthy = createProviderConfig('fast-openai', 'openai_responses', {
      status: 'healthy',
      available: true,
      latencyMs: 50
    });
    const degraded = createProviderConfig('degraded-openai', 'openai_responses', {
      status: 'degraded',
      available: true,
      latencyMs: 10
    });

    const routes = applyHealthAwareRouting(
      [
        { provider: 'openai', providerConfig: degraded },
        { provider: 'openai', providerConfig: slowHealthy },
        { provider: 'openai', providerConfig: fastHealthy }
      ],
      createConfig([degraded, slowHealthy, fastHealthy])
    );

    expect(routes.map(formatRoute)).toEqual([
      'fast-openai',
      'slow-openai',
      'degraded-openai'
    ]);
  });
});

function formatRoute(route: HealthAwareProviderRoute): string {
  return route.providerConfig?.name || route.provider;
}

function createConfig(providers: ProviderConfig[]): GatewayConfig {
  return {
    providers,
    healthAwareRouting: {
      enabled: true,
      skipUnavailable: true,
      unhealthyStatuses: ['down'],
      preferHealthy: true,
      preferLowerLatency: true
    }
  } as GatewayConfig;
}

function createProviderConfig(
  name: string,
  type: ProviderConfig['type'],
  health: ProviderConfig['health']
): ProviderConfig {
  return {
    name,
    type,
    models: ['test-model'],
    extraHeaders: {
      default: {},
      byModel: {}
    },
    extraBody: {
      default: {},
      byModel: {}
    },
    billing: {
      byModel: {}
    },
    health
  };
}
