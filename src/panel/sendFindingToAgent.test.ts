import { describe, expect, it } from 'vitest';
import { buildAllFindingsPrompt } from './sendFindingToAgent';

describe('buildAllFindingsPrompt', () => {
  it('includes site link, score, issues and suggestions', () => {
    const text = buildAllFindingsPrompt({
      reviewUuid: 'abc',
      reviewTitle: 'My review',
      siteUrl: 'https://code-critic.com/reviews/abc',
      score: 72,
      summary: 'Looks mostly fine.',
      issues: [{ message: 'Null check missing', severity: 'high', path: 'a.ts', line: 10 }],
      suggestions: ['Extract helper'],
    });
    expect(text).toContain('https://code-critic.com/reviews/abc');
    expect(text).toContain('**Score:** 72');
    expect(text).toContain('Null check missing');
    expect(text).toContain('Extract helper');
    expect(text).toContain('[high]');
  });
});
