/**
 * OpenAI-compatible encodings via the `tiktoken` WASM peer dependency (lazy, process-cached).
 *
 * @packageDocumentation
 */

import { TextDecoder } from 'node:util';

import {
  toTokenCount,
  type CompiledMessage,
  type TokenCount,
} from 'slotmux';
import { TOKEN_OVERHEAD } from 'slotmux';
import type { Tiktoken, TiktokenEncoding } from 'tiktoken';

import { tryRequireTiktoken } from './load-peer.js';
import {
  compiledMessageTokenUnits,
  countCompiledMessages,
} from './message-count.js';
import type { Tokenizer } from './tokenizer.js';

const OVERHEAD = TOKEN_OVERHEAD.openai;

const pool = new Map<TiktokenEncoding, Tiktoken>();

const utf8 = new TextDecoder('utf-8');

function getPooledEncoding(name: TiktokenEncoding): Tiktoken {
  let enc = pool.get(name);
  if (!enc) {
    const { get_encoding } = tryRequireTiktoken();
    enc = get_encoding(name);
    pool.set(name, enc);
  }
  return enc;
}

function utf8Decode(bytes: Uint8Array): string {
  return utf8.decode(bytes);
}

/**
 * Base class for `cl100k_base` and `o200k_base` tiktoken encodings.
 *
 * Encoding instances are cached for the process lifetime (call `freeTiktokenEncodings()` in tests if needed).
 */
export class TiktokenTokenizer implements Tokenizer {
  constructor(
    readonly id: TiktokenEncoding,
    private readonly encodingName: TiktokenEncoding,
  ) {}

  private enc(): Tiktoken {
    return getPooledEncoding(this.encodingName);
  }

  /** @inheritdoc */
  count(text: string): TokenCount {
    return toTokenCount(this.enc().encode_ordinary(text).length);
  }

  /** @inheritdoc */
  countMessage(message: CompiledMessage): TokenCount {
    return toTokenCount(
      compiledMessageTokenUnits(
        (s) => this.enc().encode_ordinary(s).length,
        message,
        OVERHEAD,
      ),
    );
  }

  /** @inheritdoc */
  countMessages(messages: CompiledMessage[]): TokenCount {
    return toTokenCount(
      countCompiledMessages(
        (s) => this.enc().encode_ordinary(s).length,
        messages,
        OVERHEAD,
      ),
    );
  }

  /**
   * Uses one pooled {@link Tiktoken} instance for the whole batch (§18.2 — avoids per-string encoder lookup).
   */
  countBatch(texts: readonly string[]): TokenCount[] {
    const enc = this.enc();
    const out: TokenCount[] = [];
    for (const t of texts) {
      out.push(toTokenCount(enc.encode_ordinary(t).length));
    }
    return out;
  }

  /** @inheritdoc */
  encode(text: string): number[] {
    return [...this.enc().encode_ordinary(text)];
  }

  /** @inheritdoc */
  decode(tokens: number[]): string {
    const enc = this.enc();
    const bytes = enc.decode(new Uint32Array(tokens));
    return utf8Decode(bytes);
  }

  /** @inheritdoc */
  truncateToFit(text: string, maxTokens: number): string {
    if (maxTokens <= 0) {
      return '';
    }
    const enc = this.enc();
    const ids = enc.encode_ordinary(text);
    if (ids.length <= maxTokens) {
      return text;
    }
    const bytes = enc.decode(ids.slice(0, maxTokens));
    return utf8Decode(bytes);
  }
}

/** GPT-4, GPT-4-turbo, GPT-3.5-turbo (cl100k_base). */
export class Cl100kTokenizer extends TiktokenTokenizer {
  constructor() {
    super('cl100k_base', 'cl100k_base');
  }
}

/** GPT-4o, o1, o3, and related models (o200k_base). */
export class O200kTokenizer extends TiktokenTokenizer {
  constructor() {
    super('o200k_base', 'o200k_base');
  }
}

/**
 * Release pooled tiktoken encodings (primarily for unit tests).
 */
export function freeTiktokenEncodings(): void {
  for (const enc of pool.values()) {
    enc.free();
  }
  pool.clear();
}
