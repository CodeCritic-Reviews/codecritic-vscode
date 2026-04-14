import * as vscode from 'vscode';
import type { CodeReviewPayload } from '../api/types';
import type { CodeCriticClient } from '../api/client';

const MIN_MS = 1500;
const MAX_MS = 10_000;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function pollUntilReviewDone(
  client: CodeCriticClient,
  uuid: string,
  token: vscode.CancellationToken
): Promise<CodeReviewPayload> {
  let wait = MIN_MS;
  for (;;) {
    if (token.isCancellationRequested) {
      throw new vscode.CancellationError();
    }
    const review = await client.getReview(uuid);
    const st = review.status;
    if (st === 'completed' || st === 'failed' || st === 'cancelled') {
      return review;
    }
    await delay(wait);
    wait = Math.min(Math.floor(wait * 1.4), MAX_MS);
  }
}
