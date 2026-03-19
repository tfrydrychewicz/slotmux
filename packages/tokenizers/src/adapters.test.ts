import { TokenizerNotFoundError, toTokenCount } from 'contextcraft';
import { describe, expect, it, afterEach } from 'vitest';

import {
  Cl100kTokenizer,
  O200kTokenizer,
  ClaudeTokenizer,
  SentencePieceTokenizer,
  FallbackTokenizer,
  CharEstimatorTokenizer,
  freeTiktokenEncodings,
} from './index.js';

afterEach(() => {
  freeTiktokenEncodings();
});

/** OpenAI cookbook / tiktoken spot-check: "hello world" → 2 tokens (cl100k / o200k). */
const HELLO_WORLD_TOKENS = 2;

describe('Cl100kTokenizer', () => {
  const t = new Cl100kTokenizer();

  it('counts reference string per OpenAI tiktoken docs', () => {
    expect(t.count('hello world')).toEqual(toTokenCount(HELLO_WORLD_TOKENS));
  });

  it('encode length matches count', () => {
    const s = 'The quick brown fox';
    expect(t.encode(s).length).toBe(t.count(s) as number);
  });

  it('round-trips decode(encode(text)) for plain text', () => {
    const s = 'alpha beta gamma';
    expect(t.decode(t.encode(s))).toBe(s);
  });

  it('truncateToFit respects budget', () => {
    const s = 'The quick brown fox jumps over the lazy dog';
    const out = t.truncateToFit(s, 5);
    expect(t.count(out) as number).toBeLessThanOrEqual(5);
  });
});

describe('O200kTokenizer', () => {
  const t = new O200kTokenizer();

  it('matches cl100k on ASCII sample (same token count for hello world)', () => {
    expect(t.count('hello world')).toEqual(toTokenCount(HELLO_WORLD_TOKENS));
  });
});

describe('ClaudeTokenizer', () => {
  const t = new ClaudeTokenizer();

  it('matches Anthropic countTokens for hello world (package tests use same fixture)', () => {
    expect(t.count('hello world')).toEqual(toTokenCount(HELLO_WORLD_TOKENS));
  });

  it('encode/decode round-trip for NFKC-normalizable text', () => {
    const s = 'café résumé';
    expect(t.decode(t.encode(s))).toBe(s.normalize('NFKC'));
  });
});

describe('SentencePieceTokenizer (gpt-tokenizer BPE)', () => {
  it('cl100k_base matches tiktoken token counts on samples', () => {
    const tik = new Cl100kTokenizer();
    const gpt = new SentencePieceTokenizer('cl100k_base');
    const samples = ['hello world', 'function hello() { return 42; }'];
    for (const s of samples) {
      expect(gpt.count(s) as number).toBe(tik.count(s) as number);
    }
  });

  it('o200k_base counts hello world consistently with tiktoken', () => {
    const tik = new O200kTokenizer();
    const gpt = new SentencePieceTokenizer('o200k_base');
    expect(gpt.count('hello world') as number).toBe(tik.count('hello world') as number);
  });
});

describe('FallbackTokenizer', () => {
  it('uses CharEstimatorTokenizer when primary factory throws', () => {
    const fb = new FallbackTokenizer(() => {
      throw new Error('no wasm');
    });
    expect(fb.id).toBe('char-estimator');
    expect(fb.count('aaaa')).toEqual(new CharEstimatorTokenizer().count('aaaa'));
  });

  it('uses primary when factory succeeds', () => {
    const fb = new FallbackTokenizer(() => new Cl100kTokenizer());
    expect(fb.id).toBe('cl100k_base');
    expect(fb.count('hello world')).toEqual(toTokenCount(HELLO_WORLD_TOKENS));
  });
});

describe('TokenizerNotFoundError (peer install hints)', () => {
  it('message is surfaced to developers (see load-peer.ts for thrown text)', () => {
    expect(new TokenizerNotFoundError('Install tiktoken').message).toContain('tiktoken');
    expect(new TokenizerNotFoundError('x').code).toBe('TOKENIZER_NOT_FOUND');
  });
});
