import { describe, expect, it } from 'vitest';
import { buildOpenAIHeaders } from './common';

describe('buildOpenAIHeaders', () => {
  it('uses x-api-key when authorization header is missing', () => {
    const result = buildOpenAIHeaders(
      {
        'x-api-key': 'x-api-key-token'
      } as never,
      {
        auth: {
          enabled: false,
          mode: 'trusted_header'
        }
      } as never
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.authorization).toBe('Bearer x-api-key-token');
  });

  it('prefers authorization bearer over x-api-key in trusted header mode', () => {
    const result = buildOpenAIHeaders(
      {
        authorization: 'Bearer bearer-token',
        'x-api-key': 'x-api-key-token'
      } as never,
      {
        openaiApiKey: 'managed-key',
        auth: {
          enabled: true,
          mode: 'trusted_header'
        }
      } as never
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.authorization).toBe('Bearer bearer-token');
  });

  it('prefers managed key in introspection mode', () => {
    const result = buildOpenAIHeaders(
      {
        authorization: 'Bearer bearer-token',
        'x-api-key': 'x-api-key-token'
      } as never,
      {
        openaiApiKey: 'managed-key',
        auth: {
          enabled: true,
          mode: 'http_introspection'
        }
      } as never
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.authorization).toBe('Bearer managed-key');
  });

  it('can disable OPENAI_API_KEY fallback in introspection mode', () => {
    const previousOpenAIKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'env-managed-key';

    try {
      const result = buildOpenAIHeaders(
        {
          authorization: 'Bearer bearer-token'
        } as never,
        {
          auth: {
            enabled: true,
            mode: 'http_introspection'
          },
          allowEnvApiKeyFallback: false
        } as never
      );

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }

      expect(result.value.authorization).toBe('Bearer bearer-token');
    } finally {
      if (previousOpenAIKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAIKey;
      }
    }
  });
});
