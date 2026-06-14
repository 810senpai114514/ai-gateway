import { describe, expect, it } from 'vitest';
import type { ProviderConfig } from '../types';
import { recordProviderHealthFailure, recordProviderHealthResponse } from './provider-health';

describe('provider health recording', () => {
  it('marks reachable non-transient responses healthy', () => {
    const provider = createProviderConfig();

    recordProviderHealthResponse(provider, 400, 12.4, new Date('2026-06-08T00:00:00.000Z'));

    expect(provider.health).toEqual({
      status: 'healthy',
      available: true,
      priority: 3,
      latencyMs: 12,
      checkedAt: '2026-06-08T00:00:00.000Z'
    });
  });

  it('marks rate limits and server errors degraded while keeping provider available', () => {
    const provider = createProviderConfig();

    recordProviderHealthResponse(provider, 429, 28.7, new Date('2026-06-08T00:00:01.000Z'));
    expect(provider.health).toMatchObject({
      status: 'degraded',
      available: true,
      priority: 3,
      latencyMs: 29
    });

    recordProviderHealthResponse(provider, 503, 44.2, new Date('2026-06-08T00:00:02.000Z'));
    expect(provider.health).toMatchObject({
      status: 'degraded',
      available: true,
      priority: 3,
      latencyMs: 44,
      checkedAt: '2026-06-08T00:00:02.000Z'
    });
  });

  it('marks connection failures down and unavailable', () => {
    const provider = createProviderConfig();

    recordProviderHealthFailure(provider, 101.8, new Date('2026-06-08T00:00:03.000Z'));

    expect(provider.health).toEqual({
      status: 'down',
      available: false,
      priority: 3,
      latencyMs: 102,
      checkedAt: '2026-06-08T00:00:03.000Z'
    });
  });
});

function createProviderConfig(): ProviderConfig {
  return {
    name: 'openai-main',
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
    },
    health: {
      status: 'unknown',
      priority: 3
    }
  };
}
