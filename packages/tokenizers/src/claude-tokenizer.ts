/**
 * Claude tokenizer via `@anthropic-ai/tokenizer` (lazy peer dependency).
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

import { tryRequireAnthropicTokenizer } from './load-peer.js';
import {
  compiledMessageTokenUnits,
  countCompiledMessages,
} from './message-count.js';
import type { Tokenizer } from './tokenizer.js';

const OVERHEAD = TOKEN_OVERHEAD.anthropic;

const CLAUDE_ID = 'anthropic-claude';

const utf8 = new TextDecoder('utf-8');

/**
 * Anthropic Claude BPE — wraps `countTokens` / `getTokenizer()` from the official tokenizer package.
 * Each operation acquires and releases an internal tiktoken-lite instance (matches upstream usage).
 */
export class ClaudeTokenizer implements Tokenizer {
  readonly id = CLAUDE_ID;

  private get api() {
    return tryRequireAnthropicTokenizer();
  }

  /** @inheritdoc */
  count(text: string): TokenCount {
    return toTokenCount(this.api.countTokens(text));
  }

  /** @inheritdoc */
  countMessage(message: CompiledMessage): TokenCount {
    return toTokenCount(
      compiledMessageTokenUnits(
        (s) => this.api.countTokens(s),
        message,
        OVERHEAD,
      ),
    );
  }

  /** @inheritdoc */
  countMessages(messages: CompiledMessage[]): TokenCount {
    return toTokenCount(
      countCompiledMessages(
        (s) => this.api.countTokens(s),
        messages,
        OVERHEAD,
      ),
    );
  }

  /** @inheritdoc */
  countBatch(texts: readonly string[]): TokenCount[] {
    const api = this.api;
    return texts.map((t) => toTokenCount(api.countTokens(t)));
  }

  /** @inheritdoc */
  encode(text: string): number[] {
    const t = this.api.getTokenizer();
    try {
      const normalized = text.normalize('NFKC');
      return [...t.encode(normalized, 'all')];
    } finally {
      t.free();
    }
  }

  /** @inheritdoc */
  decode(tokens: number[]): string {
    const t = this.api.getTokenizer();
    try {
      const bytes = t.decode(new Uint32Array(tokens));
      return utf8.decode(bytes);
    } finally {
      t.free();
    }
  }

  /** @inheritdoc */
  truncateToFit(text: string, maxTokens: number): string {
    if (maxTokens <= 0) {
      return '';
    }
    const t = this.api.getTokenizer();
    try {
      const normalized = text.normalize('NFKC');
      const ids = t.encode(normalized, 'all');
      if (ids.length <= maxTokens) {
        return text;
      }
      const bytes = t.decode(ids.slice(0, maxTokens));
      return utf8.decode(bytes);
    } finally {
      t.free();
    }
  }
}
