import { describe, expect, it } from 'vitest';
import { isConnectFailure, isTransientNetworkError } from './networkError';

describe('isConnectFailure', () => {
  it('matches connect timeout', () => {
    expect(isConnectFailure(new Error('fetch failed · Connect Timeout Error'))).toBe(true);
  });

  it('does not treat HTTP application errors as connect failures', () => {
    expect(isConnectFailure(new Error('HTTP 500: boom'))).toBe(false);
  });
});

describe('isTransientNetworkError', () => {
  it('matches fetch failed', () => {
    expect(isTransientNetworkError(new Error('Network error: fetch failed'))).toBe(true);
  });
});
