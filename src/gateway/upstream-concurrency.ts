import type { GatewayConfig, Provider, ProviderConfig } from '../types';

interface ProviderConcurrencyQueueItem {
  resolve: (result: ProviderConcurrencyAcquireResult) => void;
  timeout?: NodeJS.Timeout;
  settled: boolean;
}

interface ProviderConcurrencyState {
  active: number;
  queue: ProviderConcurrencyQueueItem[];
}

export type ProviderConcurrencyAcquireResult =
  | { ok: true; release: () => void }
  | {
      ok: false;
      status: 429;
      message: string;
      details: {
        provider: Provider;
        providerName?: string;
        maxInFlight: number;
        queueTimeoutMs: number;
      };
    };

const providerConcurrencyStates = new Map<string, ProviderConcurrencyState>();

export async function acquireProviderConcurrencySlot(
  config: GatewayConfig,
  provider: Provider,
  providerConfig?: ProviderConfig
): Promise<ProviderConcurrencyAcquireResult> {
  const concurrency = config.upstreamConcurrency;
  if (!concurrency?.enabled) {
    return {
      ok: true,
      release: noop
    };
  }

  const maxInFlight = normalizePositiveInteger(concurrency.maxInFlightPerProvider, 1);
  const queueTimeoutMs = normalizeNonNegativeInteger(concurrency.queueTimeoutMs, 0);
  const key = providerConcurrencyKey(provider, providerConfig);
  const state = getProviderConcurrencyState(key);

  if (state.active < maxInFlight) {
    state.active += 1;
    return {
      ok: true,
      release: () => releaseProviderConcurrencySlot(state)
    };
  }

  return await new Promise<ProviderConcurrencyAcquireResult>((resolve) => {
    const item: ProviderConcurrencyQueueItem = {
      resolve,
      settled: false
    };

    if (queueTimeoutMs === 0) {
      resolveProviderConcurrencyTimeout(item, state, provider, providerConfig, maxInFlight, queueTimeoutMs);
      return;
    }

    item.timeout = setTimeout(() => {
      resolveProviderConcurrencyTimeout(item, state, provider, providerConfig, maxInFlight, queueTimeoutMs);
    }, queueTimeoutMs);
    item.timeout.unref?.();
    state.queue.push(item);
  });
}

export function resetProviderConcurrencyForTests(): void {
  for (const state of providerConcurrencyStates.values()) {
    for (const item of state.queue) {
      if (item.timeout) {
        clearTimeout(item.timeout);
      }
      if (!item.settled) {
        item.settled = true;
        item.resolve({
          ok: false,
          status: 429,
          message: 'Provider upstream concurrency limiter was reset.',
          details: {
            provider: 'openai',
            maxInFlight: 0,
            queueTimeoutMs: 0
          }
        });
      }
    }
  }

  providerConcurrencyStates.clear();
}

function releaseProviderConcurrencySlot(state: ProviderConcurrencyState): void {
  const next = shiftNextPendingQueueItem(state);
  if (next) {
    next.settled = true;
    if (next.timeout) {
      clearTimeout(next.timeout);
    }
    next.resolve({
      ok: true,
      release: () => releaseProviderConcurrencySlot(state)
    });
    return;
  }

  state.active = Math.max(0, state.active - 1);
}

function resolveProviderConcurrencyTimeout(
  item: ProviderConcurrencyQueueItem,
  state: ProviderConcurrencyState,
  provider: Provider,
  providerConfig: ProviderConfig | undefined,
  maxInFlight: number,
  queueTimeoutMs: number
): void {
  if (item.settled) {
    return;
  }

  item.settled = true;
  removeQueueItem(state, item);
  item.resolve({
    ok: false,
    status: 429,
    message: 'Provider upstream concurrency limit exceeded.',
    details: {
      provider,
      providerName: providerConfig?.name,
      maxInFlight,
      queueTimeoutMs
    }
  });
}

function shiftNextPendingQueueItem(
  state: ProviderConcurrencyState
): ProviderConcurrencyQueueItem | undefined {
  while (state.queue.length > 0) {
    const item = state.queue.shift();
    if (item && !item.settled) {
      return item;
    }
  }

  return undefined;
}

function removeQueueItem(
  state: ProviderConcurrencyState,
  item: ProviderConcurrencyQueueItem
): void {
  const index = state.queue.indexOf(item);
  if (index >= 0) {
    state.queue.splice(index, 1);
  }
}

function getProviderConcurrencyState(key: string): ProviderConcurrencyState {
  let state = providerConcurrencyStates.get(key);
  if (!state) {
    state = {
      active: 0,
      queue: []
    };
    providerConcurrencyStates.set(key, state);
  }

  return state;
}

function providerConcurrencyKey(provider: Provider, providerConfig?: ProviderConfig): string {
  return providerConfig?.name ? `${provider}:${providerConfig.name}` : provider;
}

function normalizePositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.trunc(value);
}

function normalizeNonNegativeInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.trunc(value);
}

function noop(): void {}
