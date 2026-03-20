import { toTokenCount } from 'slotmux';
import { describe, expect, it } from 'vitest';

import {
  CHARS_PER_TOKEN_ESTIMATE,
  CharEstimatorTokenizer,
  compiledMessageToEstimationString,
} from './char-estimator.js';

describe('CharEstimatorTokenizer', () => {
  const t = new CharEstimatorTokenizer();

  it('has stable id', () => {
    expect(t.id).toBe('char-estimator');
  });

  describe('count', () => {
    it('returns 0 for empty string', () => {
      expect(t.count('')).toEqual(toTokenCount(0));
    });

    it('uses ceil(length / 4) for non-empty text', () => {
      expect(t.count('a')).toEqual(toTokenCount(1));
      expect(t.count('aaaa')).toEqual(toTokenCount(1));
      expect(t.count('aaaaa')).toEqual(toTokenCount(2));
      expect(t.count('x'.repeat(12))).toEqual(toTokenCount(3));
    });
  });

  describe('encode / decode', () => {
    it('encode length matches count for sample strings', () => {
      const samples = ['', 'hi', 'hello world', 'The quick brown fox.'];
      for (const s of samples) {
        expect(t.encode(s).length).toBe(t.count(s) as number);
      }
    });

    it('encode yields distinct fingerprints for different chunks', () => {
      const a = t.encode('aaaa');
      const b = t.encode('bbbb');
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      expect(a[0]).not.toBe(b[0]);
    });

    it('decode is explicitly non-reversing for this estimator', () => {
      expect(t.decode([1, 2, 3])).toBe('');
    });
  });

  describe('truncateToFit', () => {
    it('returns empty when maxTokens <= 0', () => {
      expect(t.truncateToFit('hello', 0)).toBe('');
      expect(t.truncateToFit('hello', -1)).toBe('');
    });

    it('returns full string when within budget', () => {
      const s = 'abcd';
      expect(t.truncateToFit(s, 10)).toBe(s);
    });

    it('shortens string to respect token budget', () => {
      const s = 'x'.repeat(20);
      const out = t.truncateToFit(s, 3);
      expect(t.count(out) as number).toBeLessThanOrEqual(3);
      expect(out.length).toBeLessThanOrEqual(s.length);
    });
  });

  describe('countMessage', () => {
    it('counts role + body with per-message overhead', () => {
      const m = { role: 'user' as const, content: 'test' };
      const rawLen = compiledMessageToEstimationString(m).length;
      const base = Math.ceil(rawLen / CHARS_PER_TOKEN_ESTIMATE);
      expect(t.countMessage(m) as number).toBe(base + 4);
    });

    it('counts higher when name is present (name is in serialized length)', () => {
      const without = { role: 'user' as const, content: 'x' };
      const withName = { ...without, name: 'alice' };
      expect(t.countMessage(withName) as number).toBeGreaterThan(
        t.countMessage(without) as number,
      );
    });

    it('handles multimodal content parts', () => {
      const m = {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'See: ' },
          {
            type: 'image_url' as const,
            image_url: { url: 'https://example.com/x.png' },
          },
        ],
      };
      expect(t.countMessage(m) as number).toBeGreaterThan(0);
    });
  });

  describe('countMessages', () => {
    it('returns 0 for empty array', () => {
      expect(t.countMessages([])).toEqual(toTokenCount(0));
    });

    it('sums messages and adds conversation overhead once', () => {
      const a = { role: 'user' as const, content: 'a' };
      const b = { role: 'assistant' as const, content: 'b' };
      const sum =
        (t.countMessage(a) as number) +
        (t.countMessage(b) as number) +
        2;
      expect(t.countMessages([a, b]) as number).toBe(sum);
    });
  });
});
