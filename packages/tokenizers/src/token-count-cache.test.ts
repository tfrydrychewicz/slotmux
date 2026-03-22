import { toTokenCount } from 'slotmux';
import { describe, expect, it } from 'vitest';


import { LRUCache } from './lru-cache.js';
import { TokenCountCache } from './token-count-cache.js';
import type { Tokenizer } from './tokenizer.js';

function mockTokenizer(
  id: string,
  countImpl: (text: string) => number,
): Tokenizer {
  return {
    id,
    count: (text) => toTokenCount(countImpl(text)),
    countBatch: (texts) => texts.map((text) => toTokenCount(countImpl(text))),
    countMessage: () => toTokenCount(0),
    countMessages: () => toTokenCount(0),
    encode: () => [],
    decode: () => '',
    truncateToFit: (t) => t,
  };
}

describe('LRUCache', () => {
  it('throws when capacity < 1', () => {
    expect(() => new LRUCache<string, number>(0)).toThrow(RangeError);
    expect(() => new LRUCache<string, number>(-1)).toThrow(RangeError);
  });

  it('get/set and MRU ordering', () => {
    const lru = new LRUCache<string, number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.get('a')).toBe(1);
    lru.set('c', 3);
    expect(lru.get('b')).toBeUndefined();
    expect(lru.get('a')).toBe(1);
    expect(lru.get('c')).toBe(3);
  });

  it('clear removes all entries', () => {
    const lru = new LRUCache<string, number>(5);
    lru.set('x', 1);
    lru.clear();
    expect(lru.size).toBe(0);
    expect(lru.get('x')).toBeUndefined();
  });
});

describe('TokenCountCache.computeKey', () => {
  it('returns a deterministic hex string', () => {
    const key1 = TokenCountCache.computeKey('cl100k_base', 'hello');
    const key2 = TokenCountCache.computeKey('cl100k_base', 'hello');
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[0-9a-f]+$/);
  });

  it('differs when tokenizer id differs for same content', () => {
    expect(TokenCountCache.computeKey('a', 'x')).not.toBe(
      TokenCountCache.computeKey('b', 'x'),
    );
  });

  it('differs when content differs for same tokenizer id', () => {
    expect(TokenCountCache.computeKey('t', 'hello')).not.toBe(
      TokenCountCache.computeKey('t', 'world'),
    );
  });

  it('produces unique keys for 10K distinct strings (collision safety)', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      keys.add(TokenCountCache.computeKey('tok', `content-${String(i)}`));
    }
    expect(keys.size).toBe(10_000);
  });
});

describe('TokenCountCache', () => {
  it('records a miss then L1 hit on repeat', () => {
    let calls = 0;
    const tok = mockTokenizer('t1', (s) => {
      calls++;
      return s.length;
    });
    const cache = new TokenCountCache({ l1Capacity: 100 });

    expect(cache.count(tok, 'abc')).toEqual(toTokenCount(3));
    expect(cache.count(tok, 'abc')).toEqual(toTokenCount(3));
    expect(calls).toBe(1);

    const m = cache.getMetrics();
    expect(m.misses).toBe(1);
    expect(m.l1Hits).toBe(1);
    expect(m.l2Hits).toBe(0);
  });

  it('promotes L2 to L1 on L2 hit', () => {
    const tok = mockTokenizer('t2', (s) => s.length);
    const cache = new TokenCountCache({ l1Capacity: 2 });

    cache.count(tok, 'a');
    cache.count(tok, 'b');
    cache.count(tok, 'c');

    expect(cache.l1Size).toBe(2);
    expect(cache.l2Size).toBe(3);

    const mBefore = cache.getMetrics();
    expect(mBefore.misses).toBe(3);

    cache.count(tok, 'a');
    const mAfter = cache.getMetrics();
    expect(mAfter.l2Hits).toBe(1);
    expect(mAfter.l1Hits).toBe(0);
  });

  it('reset clears tiers and metrics', () => {
    const tok = mockTokenizer('t3', (s) => s.length);
    const cache = new TokenCountCache({ l1Capacity: 50 });
    cache.count(tok, 'x');
    cache.count(tok, 'x');
    cache.reset();
    expect(cache.l1Size).toBe(0);
    expect(cache.l2Size).toBe(0);
    expect(cache.getMetrics()).toEqual({ l1Hits: 0, l2Hits: 0, misses: 0 });
  });

  it('after reset, counts again as miss', () => {
    let calls = 0;
    const tok = mockTokenizer('t4', () => {
      calls++;
      return 1;
    });
    const cache = new TokenCountCache({ l1Capacity: 10 });
    cache.count(tok, 'z');
    cache.reset();
    cache.count(tok, 'z');
    expect(calls).toBe(2);
    expect(cache.getMetrics().misses).toBe(1);
  });
});
