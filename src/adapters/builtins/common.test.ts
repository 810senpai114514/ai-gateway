import { describe, expect, it } from 'vitest';
import { buildOpenAIHeaders, normalizeOpenAIResponsesUsage } from './common';

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

  it('prefers managed key in static API key mode', () => {
    const result = buildOpenAIHeaders(
      {
        authorization: 'Bearer gateway-client-key',
        'x-api-key': 'gateway-client-key'
      } as never,
      {
        openaiApiKey: 'managed-key',
        auth: {
          enabled: true,
          mode: 'static_api_key'
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

describe('normalizeOpenAIResponsesUsage', () => {
  it('preserves cache creation and server tool counters', () => {
    expect(
      normalizeOpenAIResponsesUsage({
        input_tokens: 10,
        output_tokens: 3,
        total_tokens: 13,
        input_tokens_details: {
          cached_tokens: 4
        },
        cache_creation_input_tokens: 2,
        server_tool_use: {
          web_search_requests: 1,
          web_fetch_requests: 0
        }
      })
    ).toEqual({
      input_tokens: 10,
      input_tokens_details: {
        cached_tokens: 4,
        cache_creation_tokens: 2
      },
      output_tokens: 3,
      output_tokens_details: {
        reasoning_tokens: 0
      },
      total_tokens: 13,
      server_tool_use: {
        web_search_requests: 1,
        web_fetch_requests: 0
      }
    });
  });
});
