import { describe, expect, it } from 'vitest';

import { computeAdaptiveThreshold, cosineSimilarity, runSemanticCompress } from '../../src/semantic-compressor.js';
import type { SemanticScorableItem } from '../../src/semantic-types.js';

const v = {
  anchor: [1, 0, 0] as number[],
  near: [0.99, 0.01, 0] as number[],
  ortho: [0, 1, 0] as number[],
};

function item(
  id: string,
  text: string,
  at: number,
  pinned?: boolean,
): SemanticScorableItem {
  return { id, role: 'user', text, createdAt: at, pinned };
}

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('returns 0 for empty or length mismatch', () => {
    expect(cosineSimilarity([], [1])).toBe(0);
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
  });
});

describe('runSemanticCompress', () => {
  it('keeps pinned and picks highest-similarity items within budget', async () => {
    const embed = async (text: string) => {
      if (text === 'anchor') return [...v.anchor];
      if (text === 'a') return [...v.near];
      if (text === 'b') return [...v.ortho];
      if (text === 'c') return [...v.near];
      return [0, 0, 0];
    };

    const items = [
      item('a', 'a', 100),
      item('b', 'b', 200),
      item('c', 'c', 300, true),
    ];

    const out = await runSemanticCompress({
      items,
      budgetTokens: 25,
      embed,
      anchorText: 'anchor',
      countItemTokens: (i) => (i.id === 'c' ? 10 : 10),
    });

    expect(out.map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('re-sorts selected items by createdAt', async () => {
    const embed = async (text: string) => {
      if (text === 'x') return [1, 0, 0];
      if (text === 'y') return [0.5, 0.5, 0];
      return [0, 0, 1];
    };

    const items = [
      item('late', 'x', 300),
      item('mid', 'y', 200),
      item('early', 'x', 100),
    ];

    const out = await runSemanticCompress({
      items,
      budgetTokens: 100,
      embed,
      anchorText: 'x',
      countItemTokens: () => 10,
    });

    expect(out.map((x) => x.id)).toEqual(['early', 'mid', 'late']);
  });

  it('filters non-pinned by similarityThreshold', async () => {
    const embed = async (text: string) => {
      if (text === 'anchor') return [1, 0, 0];
      if (text === 'close') return [0.95, 0.05, 0];
      if (text === 'far') return [0, 1, 0];
      return [0, 0, 0];
    };

    const items = [item('close', 'close', 1), item('far', 'far', 2)];

    const out = await runSemanticCompress({
      items,
      budgetTokens: 100,
      embed,
      anchorText: 'anchor',
      similarityThreshold: 0.9,
      countItemTokens: () => 5,
    });

    expect(out.map((x) => x.id)).toEqual(['close']);
  });

  it('adaptiveThreshold filters low-similarity items automatically', async () => {
    const embed = async (text: string) => {
      if (text === 'anchor') return [1, 0, 0];
      if (text === 'high') return [0.99, 0.01, 0];
      if (text === 'med') return [0.5, 0.5, 0];
      if (text === 'low') return [0.01, 0.99, 0];
      return [0, 0, 0];
    };

    const items = [
      item('high', 'high', 1),
      item('med', 'med', 2),
      item('low', 'low', 3),
    ];

    const out = await runSemanticCompress({
      items,
      budgetTokens: 100,
      embed,
      anchorText: 'anchor',
      adaptiveThreshold: true,
      countItemTokens: () => 5,
    });

    expect(out.map((x) => x.id)).toContain('high');
    expect(out.map((x) => x.id)).not.toContain('low');
  });

  it('adaptiveThreshold with custom k adjusts strictness', async () => {
    const embed = async (text: string) => {
      if (text === 'anchor') return [1, 0, 0];
      if (text === 'a') return [0.99, 0.01, 0];
      if (text === 'b') return [0.7, 0.3, 0];
      if (text === 'c') return [0.3, 0.7, 0];
      return [0, 0, 0];
    };

    const items = [
      item('a', 'a', 1),
      item('b', 'b', 2),
      item('c', 'c', 3),
    ];

    const strict = await runSemanticCompress({
      items,
      budgetTokens: 100,
      embed,
      anchorText: 'anchor',
      adaptiveThreshold: 2.0,
      countItemTokens: () => 5,
    });

    const loose = await runSemanticCompress({
      items,
      budgetTokens: 100,
      embed,
      anchorText: 'anchor',
      adaptiveThreshold: 0.0,
      countItemTokens: () => 5,
    });

    expect(strict.length).toBeLessThanOrEqual(loose.length);
  });

  it('pinned items are always kept regardless of adaptive threshold', async () => {
    const embed = async (text: string) => {
      if (text === 'anchor') return [1, 0, 0];
      if (text === 'pinned-far') return [0.01, 0.99, 0];
      if (text === 'high') return [0.99, 0.01, 0];
      return [0, 0, 0];
    };

    const items = [
      item('pinned-far', 'pinned-far', 1, true),
      item('high', 'high', 2),
    ];

    const out = await runSemanticCompress({
      items,
      budgetTokens: 100,
      embed,
      anchorText: 'anchor',
      adaptiveThreshold: true,
      countItemTokens: () => 5,
    });

    expect(out.map((x) => x.id)).toContain('pinned-far');
  });

  it('max(adaptive, fixed) when both thresholds are set', async () => {
    const embed = async (text: string) => {
      if (text === 'anchor') return [1, 0, 0];
      if (text === 'a') return [0.85, 0.15, 0];
      if (text === 'b') return [0.5, 0.5, 0];
      return [0, 0, 0];
    };

    const items = [item('a', 'a', 1), item('b', 'b', 2)];

    const out = await runSemanticCompress({
      items,
      budgetTokens: 100,
      embed,
      anchorText: 'anchor',
      similarityThreshold: 0.8,
      adaptiveThreshold: true,
      countItemTokens: () => 5,
    });

    expect(out.map((x) => x.id)).toEqual(['a']);
  });
});

describe('computeAdaptiveThreshold', () => {
  it('returns 0 for empty scores', () => {
    expect(computeAdaptiveThreshold([])).toBe(0);
  });

  it('returns mean + stddev for default k=1', () => {
    const scores = [0.1, 0.5, 0.9];
    const mean = 0.5;
    const variance = ((0.4 ** 2) + 0 + (0.4 ** 2)) / 3;
    const expected = mean + Math.sqrt(variance);
    expect(computeAdaptiveThreshold(scores)).toBeCloseTo(expected, 10);
  });

  it('returns mean for k=0', () => {
    const scores = [0.2, 0.4, 0.6];
    expect(computeAdaptiveThreshold(scores, 0)).toBeCloseTo(0.4, 10);
  });

  it('higher k produces higher threshold', () => {
    const scores = [0.1, 0.3, 0.5, 0.7, 0.9];
    const t1 = computeAdaptiveThreshold(scores, 0.5);
    const t2 = computeAdaptiveThreshold(scores, 2.0);
    expect(t2).toBeGreaterThan(t1);
  });
});
