/**
 * Pure-JavaScript BPE via `gpt-tokenizer` (optional peer). Useful when `tiktoken` (WASM) is unavailable.
 *
 * @remarks
 * Despite the name, this uses OpenAI-compatible BPE tables shipped with `gpt-tokenizer`, not literal
 * SentencePiece. Prefer provider-specific tokenizers for exact Gemini / Mistral SPM counts; this
 * adapter matches `cl100k_base` / `o200k_base` vocabs in pure JS.
 *
 * @packageDocumentation
 */

import {
  toTokenCount,
  type CompiledMessage,
  type TokenCount,
} from 'slotmux';
import { TOKEN_OVERHEAD } from 'slotmux';

import { tryRequireGptTokenizerEncoding } from './load-peer.js';
import {
  compiledMessageTokenUnits,
  countCompiledMessages,
} from './message-count.js';
import type { Tokenizer } from './tokenizer.js';

const OVERHEAD = TOKEN_OVERHEAD.openai;

export type GptTokenizerEncodingName = 'cl100k_base' | 'o200k_base';

/**
 * BPE tokenizer backed by `gpt-tokenizer/encoding/*` (no WASM).
 */
export class SentencePieceTokenizer implements Tokenizer {
  readonly id: string;

  private mod: ReturnType<typeof tryRequireGptTokenizerEncoding> | null = null;

  constructor(private readonly encoding: GptTokenizerEncodingName) {
    this.id = `gpt-tokenizer:${encoding}`;
  }

  private enc(): ReturnType<typeof tryRequireGptTokenizerEncoding> {
    if (!this.mod) {
      this.mod = tryRequireGptTokenizerEncoding(this.encoding);
    }
    return this.mod;
  }

  /** @inheritdoc */
  count(text: string): TokenCount {
    return toTokenCount(this.enc().encode(text).length);
  }

  /** @inheritdoc */
  countMessage(message: CompiledMessage): TokenCount {
    const e = this.enc();
    return toTokenCount(
      compiledMessageTokenUnits((s) => e.encode(s).length, message),
    );
  }

  /** @inheritdoc */
  countMessages(messages: CompiledMessage[]): TokenCount {
    const e = this.enc();
    return toTokenCount(
      countCompiledMessages(
        (s) => e.encode(s).length,
        messages,
        OVERHEAD,
      ),
    );
  }

  /** @inheritdoc */
  countBatch(texts: readonly string[]): TokenCount[] {
    const e = this.enc();
    return texts.map((t) => toTokenCount(e.encode(t).length));
  }

  /** @inheritdoc */
  encode(text: string): number[] {
    return this.enc().encode(text);
  }

  /** @inheritdoc */
  decode(tokens: number[]): string {
    return this.enc().decode(tokens);
  }

  /** @inheritdoc */
  truncateToFit(text: string, maxTokens: number): string {
    if (maxTokens <= 0) {
      return '';
    }
    const e = this.enc();
    const ids = e.encode(text);
    if (ids.length <= maxTokens) {
      return text;
    }
    return e.decode(ids.slice(0, maxTokens));
  }
}
