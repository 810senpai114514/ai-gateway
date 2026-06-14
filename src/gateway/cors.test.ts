import { describe, expect, it } from 'vitest';
import { buildCorsResponseHeaders } from './cors';
import type { GatewayCorsConfig } from '../types';

describe('gateway cors headers', () => {
  it('allows any origin by default-style wildcard config', () => {
    const headers = buildCorsResponseHeaders(createCorsConfig(), 'https://app.example');

    expect(headers).toMatchObject({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400'
    });
    expect(headers.Vary).toBeUndefined();
    expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  it('echoes request origin when wildcard is combined with credentials', () => {
    const headers = buildCorsResponseHeaders(
      createCorsConfig({
        allowCredentials: true
      }),
      'https://console.example'
    );

    expect(headers['Access-Control-Allow-Origin']).toBe('https://console.example');
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
    expect(headers.Vary).toBe('Origin');
  });

  it('only emits CORS headers for configured explicit origins', () => {
    const config = createCorsConfig({
      origins: ['https://console.example']
    });

    expect(buildCorsResponseHeaders(config, 'https://console.example')).toMatchObject({
      'Access-Control-Allow-Origin': 'https://console.example',
      Vary: 'Origin'
    });
    expect(buildCorsResponseHeaders(config, 'https://other.example')).toEqual({});
  });

  it('emits no headers when disabled', () => {
    expect(
      buildCorsResponseHeaders(
        createCorsConfig({
          enabled: false
        }),
        'https://console.example'
      )
    ).toEqual({});
  });
});

function createCorsConfig(overrides: Partial<GatewayCorsConfig> = {}): GatewayCorsConfig {
  return {
    enabled: true,
    origins: ['*'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    allowedMethods: ['GET', 'POST', 'OPTIONS'],
    allowCredentials: false,
    maxAgeSeconds: 86400,
    ...overrides
  };
}
