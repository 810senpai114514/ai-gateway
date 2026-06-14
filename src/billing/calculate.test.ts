import { describe, expect, it } from 'vitest';

import { calculateUsageBilling } from './calculate';
import type { BillingConfig } from '../types';

const config: BillingConfig = {
  enabled: true,
  currency: 'USD',
  rates: {
    openai: {
      inputPerMillionUsd: 1,
      outputPerMillionUsd: 2,
      cacheReadPerMillionUsd: 0.1,
      cacheWritePerMillionUsd: 1.25
    },
    anthropic: {
      inputPerMillionUsd: 3,
      outputPerMillionUsd: 15,
      cacheReadPerMillionUsd: 0.3,
      cacheWritePerMillionUsd: 3.75
    },
    gemini: {
      inputPerMillionUsd: 1,
      outputPerMillionUsd: 2,
      cacheReadPerMillionUsd: 0.1,
      cacheWritePerMillionUsd: 1.25
    }
  }
};

describe('calculateUsageBilling total token normalization', () => {
  it('does not add OpenAI cache tokens to total when total_tokens is absent', () => {
    const result = calculateUsageBilling(
      'openai',
      {
        input_tokens: 100,
        output_tokens: 25,
        cache_read_tokens: 40,
        cache_write_tokens: 10
      },
      config
    );

    expect(result.usage.total_tokens).toBe(125);
  });

  it('adds Anthropic cache tokens to total when total_tokens is absent', () => {
    const result = calculateUsageBilling(
      'anthropic',
      {
        input_tokens: 100,
        output_tokens: 25,
        cache_read_tokens: 40,
        cache_write_tokens: 10
      },
      config
    );

    expect(result.usage.total_tokens).toBe(175);
  });
});
