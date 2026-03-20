import { describe, expect, it } from 'vitest';

import {
  estimateTokensFromText,
  truncateStringToApproxTokens,
} from './truncate-result.js';

describe('estimateTokensFromText', () => {
  it('is at least 1 for non-empty strings', () => {
    expect(estimateTokensFromText('a')).toBe(1);
    expect(estimateTokensFromText('abcd')).toBe(1);
    expect(estimateTokensFromText('abcde')).toBe(2);
  });
});

describe('truncateStringToApproxTokens', () => {
  it('returns original when under budget', () => {
    const s = 'hello';
    expect(truncateStringToApproxTokens(s, 100)).toBe(s);
  });

  it('shortens long strings and appends marker', () => {
    const long = 'x'.repeat(5000);
    const out = truncateStringToApproxTokens(long, 50);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain('[truncated]');
  });
});
