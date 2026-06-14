import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { GatewayConfig, GatewayPrecheckConfig, ProviderConfig, StandardRequest } from '../types';
import { evaluateGatewayPrecheck, resetGatewayPrecheckStateForTests } from './precheck';

type TestPrecheckConfig = Omit<GatewayPrecheckConfig, 'storage'> &
  Partial<Pick<GatewayPrecheckConfig, 'storage'>>;

describe('evaluateGatewayPrecheck', () => {
  afterEach(() => {
    resetGatewayPrecheckStateForTests();
  });

  it('rejects requests once the fixed-window rate limit is exceeded', async () => {
    const config = createConfig({
      enabled: true,
      rateLimit: {
        enabled: true,
        windowMs: 60_000,
        maxRequests: 1,
        rpm: 0,
        rpd: 0,
        tpm: 0,
        tpd: 0,
        ipm: 0,
        limits: [
          {
            enabled: true,
            name: 'requests',
            metric: 'requests',
            windowMs: 60_000,
            max: 1,
            subject: 'global',
            scope: 'global'
          }
        ],
        subject: 'global',
        scope: 'global'
      },
      quota: disabledQuota(),
      budget: disabledBudget(),
      estimation: {
        charsPerToken: 4,
        defaultMaxOutputTokens: 0
      }
    });
    const input = {
      request: createRequest(),
      config,
      targetProvider: 'openai' as const,
      model: 'gpt-test',
      standardRequest: createStandardRequest('hello')
    };

    expect((await evaluateGatewayPrecheck(input)).ok).toBe(true);

    const rejected = await evaluateGatewayPrecheck(input);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.statusCode).toBe(429);
      expect(rejected.code).toBe('rate_limit_exceeded');
      expect(rejected.details.used).toBe(1);
      expect(rejected.details.requested).toBe(1);
    }
  });

  it('enforces RPM and RPD request dimensions independently', async () => {
    const rpmConfig = createConfig({
      enabled: true,
      rateLimit: createRateLimit([
        {
          enabled: true,
          name: 'rpm',
          metric: 'requests',
          windowMs: 60_000,
          max: 1,
          subject: 'global',
          scope: 'global'
        }
      ]),
      quota: disabledQuota(),
      budget: disabledBudget(),
      estimation: {
        charsPerToken: 4,
        defaultMaxOutputTokens: 0
      }
    });
    const rpmInput = {
      request: createRequest(),
      config: rpmConfig,
      targetProvider: 'openai' as const,
      model: 'gpt-test',
      standardRequest: createStandardRequest('hello')
    };

    expect((await evaluateGatewayPrecheck(rpmInput)).ok).toBe(true);
    const rpmRejected = await evaluateGatewayPrecheck(rpmInput);
    expect(rpmRejected.ok).toBe(false);
    if (!rpmRejected.ok) {
      expect(rpmRejected.details.limit_name).toBe('rpm');
      expect(rpmRejected.details.metric).toBe('requests');
      expect(rpmRejected.details.window_ms).toBe(60_000);
    }

    resetGatewayPrecheckStateForTests();
    const rpdConfig = createConfig({
      enabled: true,
      rateLimit: createRateLimit([
        {
          enabled: true,
          name: 'rpd',
          metric: 'requests',
          windowMs: 86_400_000,
          max: 1,
          subject: 'global',
          scope: 'global'
        }
      ]),
      quota: disabledQuota(),
      budget: disabledBudget(),
      estimation: {
        charsPerToken: 4,
        defaultMaxOutputTokens: 0
      }
    });
    const rpdInput = {
      ...rpmInput,
      config: rpdConfig
    };

    expect((await evaluateGatewayPrecheck(rpdInput)).ok).toBe(true);
    const rpdRejected = await evaluateGatewayPrecheck(rpdInput);
    expect(rpdRejected.ok).toBe(false);
    if (!rpdRejected.ok) {
      expect(rpdRejected.details.limit_name).toBe('rpd');
      expect(rpdRejected.details.window_ms).toBe(86_400_000);
    }
  });

  it('enforces TPM and TPD token dimensions', async () => {
    const config = createConfig({
      enabled: true,
      rateLimit: createRateLimit([
        {
          enabled: true,
          name: 'tpm',
          metric: 'tokens',
          windowMs: 60_000,
          max: 5,
          subject: 'global',
          scope: 'model'
        },
        {
          enabled: true,
          name: 'tpd',
          metric: 'tokens',
          windowMs: 86_400_000,
          max: 100,
          subject: 'global',
          scope: 'model'
        }
      ]),
      quota: disabledQuota(),
      budget: disabledBudget(),
      estimation: {
        charsPerToken: 1,
        defaultMaxOutputTokens: 0
      }
    });

    const result = await evaluateGatewayPrecheck({
      request: createRequest(),
      config,
      targetProvider: 'openai',
      model: 'gpt-test',
      standardRequest: createStandardRequest('123456')
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('rate_limit_exceeded');
      expect(result.details.limit_name).toBe('tpm');
      expect(result.details.metric).toBe('tokens');
      expect(result.details.requested).toBe(14);
    }
  });

  it('enforces IPM image dimensions from the original request body', async () => {
    const config = createConfig({
      enabled: true,
      rateLimit: createRateLimit([
        {
          enabled: true,
          name: 'ipm',
          metric: 'images',
          windowMs: 60_000,
          max: 1,
          subject: 'global',
          scope: 'model'
        }
      ]),
      quota: disabledQuota(),
      budget: disabledBudget(),
      estimation: {
        charsPerToken: 4,
        defaultMaxOutputTokens: 0
      }
    });

    const result = await evaluateGatewayPrecheck({
      request: createRequest(),
      config,
      targetProvider: 'openai',
      model: 'gpt-test',
      standardRequest: createStandardRequest('describe'),
      requestBody: {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'compare' },
              { type: 'image_url', image_url: { url: 'https://example.com/1.png' } },
              { type: 'input_image', image_url: 'data:image/png;base64,abcd' }
            ]
          }
        ]
      }
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.details.limit_name).toBe('ipm');
      expect(result.details.metric).toBe('images');
      expect(result.details.requested).toBe(2);
      expect(result.details.estimated?.imageCount).toBe(2);
    }
  });

  it('rejects requests whose estimated token usage exceeds quota', async () => {
    const config = createConfig({
      enabled: true,
      rateLimit: disabledRateLimit(),
      quota: {
        enabled: true,
        windowMs: 60_000,
        maxTokens: 5,
        subject: 'global',
        scope: 'model'
      },
      budget: disabledBudget(),
      estimation: {
        charsPerToken: 1,
        defaultMaxOutputTokens: 0
      }
    });

    const result = await evaluateGatewayPrecheck({
      request: createRequest(),
      config,
      targetProvider: 'openai',
      model: 'gpt-test',
      standardRequest: createStandardRequest('123456')
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('quota_exceeded');
      expect(result.details.scope).toBe('model:gpt-test');
      expect(result.details.requested).toBe(14);
      expect(result.details.estimated?.inputTokens).toBe(14);
    }
  });

  it('rejects requests whose estimated cost exceeds budget', async () => {
    const config = createConfig({
      enabled: true,
      rateLimit: disabledRateLimit(),
      quota: disabledQuota(),
      budget: {
        enabled: true,
        windowMs: 86_400_000,
        maxCostUsd: 0.01,
        subject: 'global',
        scope: 'provider_model'
      },
      estimation: {
        charsPerToken: 1,
        defaultMaxOutputTokens: 1000
      }
    });

    const result = await evaluateGatewayPrecheck({
      request: createRequest(),
      config,
      targetProvider: 'openai',
      model: 'gpt-test',
      standardRequest: createStandardRequest('prompt')
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(402);
      expect(result.code).toBe('budget_exceeded');
      expect(result.details.scope).toBe('provider:openai:model:gpt-test');
      expect(result.details.estimated?.estimatedCostUsd).toBeGreaterThan(0.01);
    }
  });

});

function disabledRateLimit(): GatewayPrecheckConfig['rateLimit'] {
  return createRateLimit([]);
}

function createRateLimit(
  limits: GatewayPrecheckConfig['rateLimit']['limits']
): GatewayPrecheckConfig['rateLimit'] {
  return {
    enabled: false,
    windowMs: 60_000,
    maxRequests: 0,
    rpm: 0,
    rpd: 0,
    tpm: 0,
    tpd: 0,
    ipm: 0,
    limits: [],
    ...(limits.length > 0
      ? {
          enabled: true,
          limits
        }
      : {}),
    subject: 'identity',
    scope: 'global'
  };
}

function disabledQuota(): GatewayPrecheckConfig['quota'] {
  return {
    enabled: false,
    windowMs: 86_400_000,
    maxTokens: 0,
    subject: 'identity',
    scope: 'global'
  };
}

function disabledBudget(): GatewayPrecheckConfig['budget'] {
  return {
    enabled: false,
    windowMs: 86_400_000,
    maxCostUsd: 0,
    subject: 'identity',
    scope: 'global'
  };
}

function createStandardRequest(input: string): StandardRequest {
  return {
    model: 'gpt-test',
    input,
    max_output_tokens: 0
  };
}

function createRequest(): FastifyRequest {
  return {
    headers: {},
    ip: '127.0.0.1',
    socket: {
      remoteAddress: '127.0.0.1'
    }
  } as unknown as FastifyRequest;
}

function createConfig(precheck: TestPrecheckConfig): GatewayConfig {
  const provider = createProviderConfig();
  return {
    providers: [provider],
    precheck: {
      ...precheck,
      storage: precheck.storage || memoryPrecheckStorage()
    },
    billing: {
      enabled: true,
      currency: 'USD',
      rates: {
        openai: {
          inputPerMillionUsd: 1000,
          outputPerMillionUsd: 1000
        },
        anthropic: {
          inputPerMillionUsd: 0,
          outputPerMillionUsd: 0
        },
        gemini: {
          inputPerMillionUsd: 0,
          outputPerMillionUsd: 0
        }
      }
    }
  } as GatewayConfig;
}

function memoryPrecheckStorage(): GatewayPrecheckConfig['storage'] {
  return {
    type: 'memory'
  };
}

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
    }
  };
}
