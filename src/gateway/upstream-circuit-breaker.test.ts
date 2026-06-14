import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseGatewayConfigFromRaw } from '../config';
import type { ProviderConfig } from '../types';
import {
  checkProviderCircuitBreaker,
  recordProviderCircuitBreakerFailure,
  recordProviderCircuitBreakerResponse,
  resetProviderCircuitBreakerForTests
} from './upstream-circuit-breaker';

describe('gateway upstream circuit breaker', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetProviderCircuitBreakerForTests();
  });

  it('opens after consecutive failures and closes after cooldown', () => {
    vi.useFakeTimers();
    const config = parseGatewayConfigFromRaw({
      upstreamCircuitBreaker: {
        enabled: true,
        failureThreshold: 2,
        cooldownMs: 1000,
        failureStatusCodes: [500]
      }
    });
    const provider = createProviderConfig('openai-main');

    expect(checkProviderCircuitBreaker(config, 'openai', provider).ok).toBe(true);
    recordProviderCircuitBreakerFailure(config, 'openai', provider);
    expect(checkProviderCircuitBreaker(config, 'openai', provider).ok).toBe(true);

    recordProviderCircuitBreakerResponse(config, 'openai', provider, 500);
    const open = checkProviderCircuitBreaker(config, 'openai', provider);
    expect(open).toMatchObject({
      ok: false,
      status: 503,
      message: 'Provider upstream circuit breaker is open.',
      details: {
        provider: 'openai',
        providerName: 'openai-main',
        failureThreshold: 2,
        cooldownMs: 1000
      }
    });

    vi.advanceTimersByTime(1001);
    expect(checkProviderCircuitBreaker(config, 'openai', provider).ok).toBe(true);
  });

  it('resets consecutive failures after a non-failure response', () => {
    const config = parseGatewayConfigFromRaw({
      upstreamCircuitBreaker: {
        enabled: true,
        failureThreshold: 2,
        cooldownMs: 1000,
        failureStatusCodes: [500]
      }
    });
    const provider = createProviderConfig('openai-main');

    recordProviderCircuitBreakerResponse(config, 'openai', provider, 500);
    recordProviderCircuitBreakerResponse(config, 'openai', provider, 200);
    recordProviderCircuitBreakerResponse(config, 'openai', provider, 500);

    expect(checkProviderCircuitBreaker(config, 'openai', provider).ok).toBe(true);
  });

  it('keeps named providers isolated', () => {
    const config = parseGatewayConfigFromRaw({
      upstreamCircuitBreaker: {
        enabled: true,
        failureThreshold: 1,
        cooldownMs: 1000,
        failureStatusCodes: [500]
      }
    });

    recordProviderCircuitBreakerResponse(config, 'openai', createProviderConfig('openai-a'), 500);

    expect(checkProviderCircuitBreaker(config, 'openai', createProviderConfig('openai-a')).ok).toBe(false);
    expect(checkProviderCircuitBreaker(config, 'openai', createProviderConfig('openai-b')).ok).toBe(true);
  });
});

function createProviderConfig(name: string): ProviderConfig {
  return {
    name,
    type: 'openai_responses',
    models: ['gpt-test'],
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
    }
  };
}
