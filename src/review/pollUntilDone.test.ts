import { describe, expect, it, vi } from 'vitest';
import { pollUntilReviewDone, DEFAULT_POLL_TIMEOUT_MS } from './pollUntilDone';
import type { CodeCriticClient } from '../api/client';
import type { CodeReviewPayload } from '../api/types';

function fakeToken(cancelled = false): { isCancellationRequested: boolean } {
  return { isCancellationRequested: cancelled };
}

describe('pollUntilReviewDone', () => {
  it('returns when status is completed', async () => {
    const review = { uuid: 'u1', status: 'completed' } as CodeReviewPayload;
    const client = {
      getReview: vi.fn().mockResolvedValue(review),
    } as unknown as CodeCriticClient;

    const result = await pollUntilReviewDone(client, 'u1', fakeToken() as never, {
      sleep: async () => undefined,
      now: () => 0,
    });
    expect(result.status).toBe('completed');
    expect(client.getReview).toHaveBeenCalledTimes(1);
  });

  it('times out after timeoutMs', async () => {
    let t = 0;
    const client = {
      getReview: vi.fn().mockResolvedValue({ uuid: 'u1', status: 'pending' }),
    } as unknown as CodeCriticClient;

    await expect(
      pollUntilReviewDone(client, 'u1', fakeToken() as never, {
        timeoutMs: 100,
        now: () => {
          const cur = t;
          t += 200;
          return cur;
        },
        sleep: async () => undefined,
      })
    ).rejects.toThrow(/timed out/i);
  });

  it('retries transient network errors then completes', async () => {
    const review = { uuid: 'u1', status: 'completed' } as CodeReviewPayload;
    const client = {
      getReview: vi
        .fn()
        .mockRejectedValueOnce(new Error('fetch failed · Connect Timeout Error'))
        .mockResolvedValueOnce(review),
    } as unknown as CodeCriticClient;

    const result = await pollUntilReviewDone(client, 'u1', fakeToken() as never, {
      sleep: async () => undefined,
      now: () => 0,
    });
    expect(result.status).toBe('completed');
    expect(client.getReview).toHaveBeenCalledTimes(2);
  });

  it('exports an 8-minute default timeout', () => {
    expect(DEFAULT_POLL_TIMEOUT_MS).toBe(8 * 60 * 1000);
  });
});
