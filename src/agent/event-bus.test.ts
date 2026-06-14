import { describe, expect, it } from 'vitest';
import { InMemoryAgentEventBus } from './event-bus';
import type { AgentEvent } from './types';

describe('InMemoryAgentEventBus', () => {
  it('dispatches different sessions in parallel while preserving per-session order', async () => {
    const bus = new InMemoryAgentEventBus();
    const completed: string[] = [];
    const completedAt = new Map<string, number>();

    bus.subscribe(async (event) => {
      const payload = event.payload as { label: string; delayMs: number };
      await delay(payload.delayMs);
      completed.push(payload.label);
      completedAt.set(payload.label, Date.now());
    });

    const startedAt = Date.now();
    bus.publish(buildEvent('event-1', 'session-a', 'a1', 200));
    bus.publish(buildEvent('event-2', 'session-a', 'a2', 0));
    bus.publish(buildEvent('event-3', 'session-b', 'b1', 10));

    await waitFor(() => completedAt.size === 3, 800);
    await bus.close();

    expect(completed.indexOf('a1')).toBeLessThan(completed.indexOf('a2'));
    expect((completedAt.get('b1') || 0) - startedAt).toBeLessThan(150);
  });

  it('waits inflight dispatches when closing', async () => {
    const bus = new InMemoryAgentEventBus();
    let handled = false;

    bus.subscribe(async () => {
      await delay(40);
      handled = true;
    });

    bus.publish(buildEvent('event-4', 'session-c', 'c1', 0));
    await bus.close();

    expect(handled).toBe(true);
  });
});

function buildEvent(
  id: string,
  sessionId: string,
  label: string,
  delayMs: number
): AgentEvent<{ label: string; delayMs: number }> {
  return {
    id,
    type: 'USER_INPUT',
    sessionId,
    timestamp: new Date().toISOString(),
    correlationId: `corr-${id}`,
    payload: {
      label,
      delayMs
    }
  };
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) {
      return;
    }
    await delay(10);
  }
  throw new Error('waitFor timeout');
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
