import { describe, expect, it } from 'vitest';
import { isRetryableError, isRetryableHttpStatus, runWithRetry } from './retry';

describe('runWithRetry', () => {
  it('retries until success with backoff policy', async () => {
    let attempts = 0;

    const result = await runWithRetry({
      stage: 'test.retry',
      policy: {
        maxAttempts: 3,
        baseDelayMs: 5,
        maxDelayMs: 20,
        backoffMultiplier: 2,
        jitterMs: 0
      },
      shouldRetry: () => true,
      operation: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error('temporary network error');
        }
        return 'ok';
      }
    });

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('stops retrying when shouldRetry returns false', async () => {
    let attempts = 0;

    await expect(
      runWithRetry({
        stage: 'test.no-retry',
        policy: {
          maxAttempts: 5,
          baseDelayMs: 1,
          maxDelayMs: 10,
          backoffMultiplier: 2,
          jitterMs: 0
        },
        shouldRetry: () => false,
        operation: async () => {
          attempts += 1;
          throw new Error('fatal');
        }
      })
    ).rejects.toThrow('fatal');

    expect(attempts).toBe(1);
  });
});

describe('retry helpers', () => {
  it('marks transient status as retryable', () => {
    expect(isRetryableHttpStatus(429)).toBe(true);
    expect(isRetryableHttpStatus(503)).toBe(true);
    expect(isRetryableHttpStatus(400)).toBe(false);
  });

  it('marks transient errors as retryable', () => {
    expect(isRetryableError(new Error('network timeout'))).toBe(true);
    expect(isRetryableError(new Error('rate limit exceeded'))).toBe(true);
    expect(isRetryableError(new Error('validation failed'))).toBe(false);
  });

  it('marks retryable http status and error codes as retryable', () => {
    const rateLimitError = new Error('request failed') as Error & { status?: number };
    rateLimitError.status = 429;

    const connectionResetError = new Error('upstream request failed') as Error & { code?: string };
    connectionResetError.code = 'ECONNRESET';

    expect(isRetryableError(rateLimitError)).toBe(true);
    expect(isRetryableError(connectionResetError)).toBe(true);
  });
});
