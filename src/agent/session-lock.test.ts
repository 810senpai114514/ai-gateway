import { describe, expect, it } from 'vitest';
import { SessionLockAcquireTimeoutError, SessionLockManager } from './session-lock';

describe('SessionLockManager', () => {
  it('times out when waiting lock exceeds timeout', async () => {
    const manager = new SessionLockManager();
    const release = await manager.acquire('session-timeout');

    await expect(
      manager.acquire('session-timeout', {
        timeoutMs: 30
      })
    ).rejects.toBeInstanceOf(SessionLockAcquireTimeoutError);

    release();
  });

  it('supports aborting a waiting lock acquisition', async () => {
    const manager = new SessionLockManager();
    const release = await manager.acquire('session-abort');
    const controller = new AbortController();

    const waiting = manager.acquire('session-abort', {
      signal: controller.signal
    });
    controller.abort();

    await expect(waiting).rejects.toMatchObject({
      name: 'AbortError'
    });
    release();
  });

  it('grants queued lock after release', async () => {
    const manager = new SessionLockManager();
    const release1 = await manager.acquire('session-order');

    const acquired = manager.acquire('session-order');
    release1();

    const release2 = await acquired;
    expect(manager.isLocked('session-order')).toBe(true);
    release2();
    expect(manager.isLocked('session-order')).toBe(false);
  });
});
