/**
 * Fast character-based token estimation (~4 UTF-16 code units per token).
 *
 * @packageDocumentation
 */

import {
  toTokenCount,
  TOKEN_OVERHEAD,
  type CompiledMessage,
  type TokenCount,
} from 'slotmux';

import {
  compiledMessageTokenUnits,
  countCompiledMessages,
} from './message-count.js';
import type { Tokenizer } from './tokenizer.js';

/** Default UTF-16 code units per estimated token (§18.2). */
export const CHARS_PER_TOKEN_ESTIMATE = 4;

/** Char estimator aligns with OpenAI-style §9.4 defaults for rough cross-provider parity. */
const OVERHEAD = TOKEN_OVERHEAD.openai;

function estimateTokensFromCharLength(charLength: number): number {
  if (charLength <= 0) {
    return 0;
  }
  return Math.ceil(charLength / CHARS_PER_TOKEN_ESTIMATE);
}

/**
 * Char-length tokenizer: `ceil(length / 4)` tokens per string (0 when empty).
 *
 * `encode` returns one 32-bit FNV-1a fingerprint per chunk (same length as {@link count}).
 * {@link decode} is a no-op concatenation — hashes are not reversible; use a model-specific
 * tokenizer when you need real encode/decode.
 */
export class CharEstimatorTokenizer implements Tokenizer {
  readonly id = 'char-estimator';

  /** @inheritdoc */
  count(text: string): TokenCount {
    return toTokenCount(estimateTokensFromCharLength(text.length));
  }

  /** @inheritdoc */
  countMessage(message: CompiledMessage): TokenCount {
    return toTokenCount(
      compiledMessageTokenUnits(
        (s) => estimateTokensFromCharLength(s.length),
        message,
        OVERHEAD,
      ),
    );
  }

  /** @inheritdoc */
  countMessages(messages: CompiledMessage[]): TokenCount {
    if (messages.length === 0) {
      return toTokenCount(0);
    }
    return toTokenCount(
      countCompiledMessages(
        (s) => estimateTokensFromCharLength(s.length),
        messages,
        OVERHEAD,
      ),
    );
  }

  /** @inheritdoc */
  countBatch(texts: readonly string[]): TokenCount[] {
    return texts.map((t) => this.count(t));
  }

  /** @inheritdoc */
  encode(text: string): number[] {
    const out: number[] = [];
    for (let i = 0; i < text.length; i += CHARS_PER_TOKEN_ESTIMATE) {
      out.push(fnv1a32(text.slice(i, i + CHARS_PER_TOKEN_ESTIMATE)));
    }
    return out;
  }

  /** @inheritdoc */
  decode(tokens: number[]): string {
    void tokens;
    return '';
  }

  /** @inheritdoc */
  truncateToFit(text: string, maxTokens: number): string {
    if (maxTokens <= 0) {
      return '';
    }
    const maxChars = maxTokens * CHARS_PER_TOKEN_ESTIMATE;
    if (text.length <= maxChars) {
      return text;
    }
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const n = estimateTokensFromCharLength(mid);
      if (n <= maxTokens) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return text.slice(0, lo);
  }
}

/** FNV-1a 32-bit — stable fingerprint for a chunk (not reversible). */
function fnv1a32(chunk: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < chunk.length; i++) {
    h ^= chunk.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export { compiledMessageToEstimationString } from './compiled-message-string.js';
