import { describe, expect, it } from 'vitest';
import { joinApiUrl, normalizeApiKey, sanitizeApiBaseUrl } from './client';

describe('normalizeApiKey', () => {
  it('keeps hex digits only', () => {
    expect(normalizeApiKey('ab-cd_ef GH')).toBe('abcdef');
    expect(normalizeApiKey('DEADBEEF')).toBe('DEADBEEF');
  });

  it('strips BOM and non-ascii', () => {
    expect(normalizeApiKey('\uFEFFabc123')).toBe('abc123');
    expect(normalizeApiKey('ключabc')).toBe('abc');
  });
});

describe('sanitizeApiBaseUrl', () => {
  it('trims trailing slashes and non-ascii', () => {
    expect(sanitizeApiBaseUrl('https://api.code-critic.com/')).toBe('https://api.code-critic.com');
    expect(sanitizeApiBaseUrl('http://localhost:9292/api///')).toBe('http://localhost:9292/api');
  });
});

describe('joinApiUrl', () => {
  it('joins production host with v1 path', () => {
    expect(joinApiUrl('https://api.code-critic.com', 'v1/code_reviews')).toBe(
      'https://api.code-critic.com/v1/code_reviews'
    );
  });

  it('preserves local /api prefix', () => {
    expect(joinApiUrl('http://localhost:9292/api', 'v1/code_reviews')).toBe(
      'http://localhost:9292/api/v1/code_reviews'
    );
  });

  it('rejects invalid base', () => {
    expect(() => joinApiUrl('not a url', 'v1/x')).toThrow(/Invalid API base URL/);
  });
});
