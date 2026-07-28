import * as vscode from 'vscode';
import type { CodeReviewPayload } from '../api/types';
import type { CodeCriticClient } from '../api/client';
import { isTransientNetworkError } from '../api/networkError';

const MIN_MS = 1500;
const MAX_MS = 10_000;

/** Default max wait for a review to finish (8 minutes). */
export const DEFAULT_POLL_TIMEOUT_MS = 8 * 60 * 1000;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type PollUntilDoneOptions = {
  timeoutMs?: number;
  /** Injectable clock for tests */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export async function pollUntilReviewDone(
  client: CodeCriticClient,
  uuid: string,
  token: vscode.CancellationToken,
  options: PollUntilDoneOptions = {}
): Promise<CodeReviewPayload> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? delay;
  const started = now();
  let wait = MIN_MS;
  let consecutiveNetworkFailures = 0;

  for (;;) {
    if (token.isCancellationRequested) {
      throw new vscode.CancellationError();
    }
    if (now() - started > timeoutMs) {
      throw new Error(
        `Review timed out after ${Math.round(timeoutMs / 1000)}s (uuid ${uuid}). Try CodeCritic: Open last review result - the job may already be done on the server.`
      );
    }

    try {
      const review = await client.getReview(uuid);
      consecutiveNetworkFailures = 0;
      const st = review.status;
      if (st === 'completed' || st === 'failed' || st === 'cancelled') {
        return review;
      }
    } catch (e) {
      if (!isTransientNetworkError(e)) {
        throw e;
      }
      consecutiveNetworkFailures += 1;
      // Keep waiting within the overall budget; one 10s connect timeout must not abort the poll.
      if (consecutiveNetworkFailures >= 20) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(
          `Too many network errors while waiting for review ${uuid}. Last error: ${detail}. Try CodeCritic: Open last review result.`
        );
      }
    }

    await sleep(wait);
    wait = Math.min(Math.floor(wait * 1.4), MAX_MS);
  }
}
