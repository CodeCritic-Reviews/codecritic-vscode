/** Classify flaky network failures for retry / poll continue. */

export function networkErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const cause =
    e instanceof Error && e.cause instanceof Error
      ? e.cause.message
      : e instanceof Error && e.cause != null
        ? String(e.cause)
        : '';
  return `${msg} ${cause}`;
}

/** Safe to continue a poll loop (GET) after this error. */
export function isTransientNetworkError(e: unknown): boolean {
  return /fetch failed|connect timeout|headers timeout|body timeout|etimedout|econnreset|econnrefused|enotfound|socket|network error|tls|certificate|undici|getaddrinfo/i.test(
    networkErrorText(e)
  );
}

/**
 * Safe to retry POST create: connection never established (no risk of duplicate charged review).
 * Do not retry after headers/body timeouts - the server may already have accepted the body.
 */
export function isConnectFailure(e: unknown): boolean {
  return /connect timeout|econnrefused|enotfound|getaddrinfo|not known|nxdomain|ehostunreach|enetunreach/i.test(
    networkErrorText(e)
  );
}
