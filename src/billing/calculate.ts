import type { BillingConfig, BillingRate, BillingTier, Provider, StandardUsage } from '../types';

const TOKENS_PER_MILLION = 1_000_000;

export interface BillingChargeBreakdown {
  source: 'tier' | 'base';
  start_token: number;
  end_token: number;
  billed_tokens: number;
  per_million_usd: number;
  cost: number;
}

export interface BillingResult {
  provider: Provider;
  currency: 'USD';
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    total_tokens: number;
    cache_duration_seconds: number;
  };
  rates: {
    input_per_million_usd: number;
    output_per_million_usd: number;
    cache_read_per_million_usd: number;
    cache_write_per_million_usd: number;
  };
  cost: {
    input: number;
    output: number;
    cache_read: number;
    cache_write: number;
    tiered: number;
    total: number;
  };
  breakdown: {
    input: BillingChargeBreakdown[];
    output: BillingChargeBreakdown[];
    cache_read: BillingChargeBreakdown[];
    cache_write: BillingChargeBreakdown[];
  };
}

export function calculateUsageBilling(
  provider: Provider,
  usage: StandardUsage,
  config: BillingConfig,
  rateOverride?: BillingRate
): BillingResult {
  const rate = rateOverride || config.rates[provider];
  const inputTokens = normalizeTokenCount(usage.input_tokens);
  const outputTokens = normalizeTokenCount(usage.output_tokens);
  const cacheReadTokens = normalizeTokenCount(usage.cache_read_tokens);
  const cacheWriteTokens = normalizeTokenCount(usage.cache_write_tokens);
  const totalTokensFromUsage = normalizeTokenCount(usage.total_tokens);
  const cacheDurationSeconds = normalizeDurationSeconds(
    usage.cache_duration_seconds ?? usage.cache_ttl_seconds ?? usage.cache_age_seconds
  );
  const totalTokens = resolveTotalTokens(
    provider,
    totalTokensFromUsage,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens
  );

  const inputCost = calculateCostByRateAndTiers(
    inputTokens,
    rate.inputPerMillionUsd,
    rate.tiers?.input
  );
  const outputCost = calculateCostByRateAndTiers(
    outputTokens,
    rate.outputPerMillionUsd,
    rate.tiers?.output
  );
  const cacheReadRate = rate.cacheReadPerMillionUsd ?? 0;
  const cacheWriteRate = rate.cacheWritePerMillionUsd ?? 0;
  const cacheReadCost = calculateCostByRateAndTiers(
    cacheReadTokens,
    cacheReadRate,
    rate.tiers?.cacheRead
  );
  const cacheWriteCost = calculateCostByRateAndTiers(
    cacheWriteTokens,
    cacheWriteRate,
    rate.tiers?.cacheWrite
  );
  const totalCost = roundMoney(
    inputCost.total_cost + outputCost.total_cost + cacheReadCost.total_cost + cacheWriteCost.total_cost
  );
  const tieredCost = roundMoney(
    inputCost.tiered_cost + outputCost.tiered_cost + cacheReadCost.tiered_cost + cacheWriteCost.tiered_cost
  );

  return {
    provider,
    currency: config.currency,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: cacheReadTokens,
      cache_write_tokens: cacheWriteTokens,
      total_tokens: totalTokens,
      cache_duration_seconds: cacheDurationSeconds
    },
    rates: {
      input_per_million_usd: rate.inputPerMillionUsd,
      output_per_million_usd: rate.outputPerMillionUsd,
      cache_read_per_million_usd: cacheReadRate,
      cache_write_per_million_usd: cacheWriteRate
    },
    cost: {
      input: inputCost.total_cost,
      output: outputCost.total_cost,
      cache_read: cacheReadCost.total_cost,
      cache_write: cacheWriteCost.total_cost,
      tiered: tieredCost,
      total: totalCost
    },
    breakdown: {
      input: inputCost.breakdown,
      output: outputCost.breakdown,
      cache_read: cacheReadCost.breakdown,
      cache_write: cacheWriteCost.breakdown
    },
  };
}

function resolveTotalTokens(
  provider: Provider,
  totalTokensFromUsage: number,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number
) {
  if (totalTokensFromUsage > 0) {
    return totalTokensFromUsage;
  }

  if (provider === 'anthropic') {
    return inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  }

  return inputTokens + outputTokens;
}

export function buildBillingHeaders(result: BillingResult): Record<string, string> {
  return {
    'x-gateway-billing-provider': result.provider,
    'x-gateway-billing-currency': result.currency,
    'x-gateway-billing-input-tokens': String(result.usage.input_tokens),
    'x-gateway-billing-output-tokens': String(result.usage.output_tokens),
    'x-gateway-billing-cache-read-tokens': String(result.usage.cache_read_tokens),
    'x-gateway-billing-cache-write-tokens': String(result.usage.cache_write_tokens),
    'x-gateway-billing-total-tokens': String(result.usage.total_tokens),
    'x-gateway-billing-cache-duration-seconds': String(result.usage.cache_duration_seconds),
    'x-gateway-billing-input-cost': formatMoney(result.cost.input),
    'x-gateway-billing-output-cost': formatMoney(result.cost.output),
    'x-gateway-billing-cache-read-cost': formatMoney(result.cost.cache_read),
    'x-gateway-billing-cache-write-cost': formatMoney(result.cost.cache_write),
    'x-gateway-billing-tiered-cost': formatMoney(result.cost.tiered),
    'x-gateway-billing-total-cost': formatMoney(result.cost.total)
  };
}

function calculateCostByRateAndTiers(
  tokens: number,
  basePerMillionUsd: number,
  tiersRaw: BillingTier[] | undefined
): {
  total_cost: number;
  tiered_cost: number;
  breakdown: BillingChargeBreakdown[];
} {
  if (tokens <= 0) {
    return {
      total_cost: 0,
      tiered_cost: 0,
      breakdown: []
    };
  }

  const tiers = normalizeTiers(tiersRaw);
  if (tiers.length === 0) {
    return {
      total_cost: roundMoney((tokens / TOKENS_PER_MILLION) * basePerMillionUsd),
      tiered_cost: 0,
      breakdown: [
        {
          source: 'base',
          start_token: 0,
          end_token: tokens,
          billed_tokens: tokens,
          per_million_usd: basePerMillionUsd,
          cost: roundMoney((tokens / TOKENS_PER_MILLION) * basePerMillionUsd)
        }
      ]
    };
  }

  let totalCostRaw = 0;
  let tieredCostRaw = 0;
  let consumed = 0;
  const breakdown: BillingChargeBreakdown[] = [];

  for (const tier of tiers) {
    if (consumed >= tokens) {
      break;
    }

    const upper = tier.upToTokens ?? Number.POSITIVE_INFINITY;
    if (upper <= consumed) {
      continue;
    }

    const billed = Math.max(Math.min(tokens, upper) - consumed, 0);
    if (billed <= 0) {
      continue;
    }

    const segmentStart = consumed;
    const segmentEnd = consumed + billed;
    const segmentCostRaw = (billed / TOKENS_PER_MILLION) * tier.perMillionUsd;
    totalCostRaw += segmentCostRaw;
    tieredCostRaw += segmentCostRaw;
    breakdown.push({
      source: 'tier',
      start_token: segmentStart,
      end_token: segmentEnd,
      billed_tokens: billed,
      per_million_usd: tier.perMillionUsd,
      cost: roundMoney(segmentCostRaw)
    });
    consumed += billed;
  }

  if (consumed < tokens) {
    const billed = tokens - consumed;
    const segmentCostRaw = (billed / TOKENS_PER_MILLION) * basePerMillionUsd;
    totalCostRaw += segmentCostRaw;
    breakdown.push({
      source: 'base',
      start_token: consumed,
      end_token: tokens,
      billed_tokens: billed,
      per_million_usd: basePerMillionUsd,
      cost: roundMoney(segmentCostRaw)
    });
  }

  return {
    total_cost: roundMoney(totalCostRaw),
    tiered_cost: roundMoney(tieredCostRaw),
    breakdown
  };
}

function normalizeTiers(tiersRaw: BillingTier[] | undefined): BillingTier[] {
  if (!Array.isArray(tiersRaw)) {
    return [];
  }

  const tiers = tiersRaw
    .filter((tier) => {
      if (!Number.isFinite(tier.perMillionUsd) || tier.perMillionUsd < 0) {
        return false;
      }

      if (tier.upToTokens === undefined) {
        return true;
      }

      return Number.isFinite(tier.upToTokens) && tier.upToTokens > 0;
    })
    .map((tier) => ({
      upToTokens:
        tier.upToTokens !== undefined ? Math.max(0, Math.trunc(tier.upToTokens)) : undefined,
      perMillionUsd: tier.perMillionUsd
    }));

  tiers.sort((a, b) => {
    const aUpper = a.upToTokens ?? Number.POSITIVE_INFINITY;
    const bUpper = b.upToTokens ?? Number.POSITIVE_INFINITY;
    return aUpper - bUpper;
  });

  return tiers;
}

function normalizeTokenCount(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.trunc(value);
}

function normalizeDurationSeconds(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.trunc(value);
}

function roundMoney(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

function formatMoney(value: number): string {
  return value.toFixed(8);
}
