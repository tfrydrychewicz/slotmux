import type { ContentId } from 'contextcraft';
import { describe, expect, it } from 'vitest';

import {
  dedupeNearDuplicateChunks,
  jaccardSimilarity,
  ragItemPlainText,
} from './dedupe.js';

const id = (s: string): ContentId => s as ContentId;

describe('jaccardSimilarity', () => {
  it('returns 1 for identical normalized text', () => {
    expect(jaccardSimilarity('hello world', 'hello   world')).toBe(1);
  });

  it('returns 0 for disjoint vocab', () => {
    expect(jaccardSimilarity('aaa bbb', 'ccc ddd')).toBe(0);
  });
});

describe('ragItemPlainText', () => {
  it('joins multimodal text blocks', () => {
    const item = {
      id: id('1'),
      role: 'user' as const,
      slot: 'rag',
      content: [
        { type: 'text' as const, text: 'a' },
        { type: 'text' as const, text: 'b' },
      ],
      createdAt: 0,
    };
    expect(ragItemPlainText(item)).toBe('a\nb');
  });
});

describe('dedupeNearDuplicateChunks', () => {
  it('removes second near-duplicate', () => {
    const base = {
      role: 'user' as const,
      slot: 'rag',
      createdAt: 0,
    };
    const shared =
      'The quick brown fox jumps over the lazy dog near the forest edge every morning.';
    const a = { ...base, id: id('a'), content: shared };
    const b = { ...base, id: id('b'), content: `  ${shared}  ` };
    const c = {
      ...base,
      id: id('c'),
      content: 'Totally different content about databases.',
    };
    const out = dedupeNearDuplicateChunks([a, b, c], 0.88);
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.id).sort()).toEqual(['a', 'c']);
  });
});
