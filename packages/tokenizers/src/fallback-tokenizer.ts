/**
 * Tries a primary tokenizer factory and falls back when loading or construction fails.
 *
 * @packageDocumentation
 */

import type { CompiledMessage } from 'slotmux';

import { CharEstimatorTokenizer } from './char-estimator.js';
import type { Tokenizer } from './tokenizer.js';

/**
 * Lazily resolves `primary` on first use; if it throws, uses `fallback` (default {@link CharEstimatorTokenizer}).
 */
export class FallbackTokenizer implements Tokenizer {
  private resolved: Tokenizer | null = null;

  constructor(
    private readonly primary: () => Tokenizer,
    private readonly fallback: Tokenizer = new CharEstimatorTokenizer(),
  ) {}

  private get inner(): Tokenizer {
    if (!this.resolved) {
      try {
        this.resolved = this.primary();
      } catch {
        this.resolved = this.fallback;
      }
    }
    return this.resolved;
  }

  /** Resolved implementation id (primary or fallback). */
  get id(): string {
    return this.inner.id;
  }

  /** @inheritdoc */
  count(text: string) {
    return this.inner.count(text);
  }

  /** @inheritdoc */
  countMessage(message: CompiledMessage) {
    return this.inner.countMessage(message);
  }

  /** @inheritdoc */
  countMessages(messages: CompiledMessage[]) {
    return this.inner.countMessages(messages);
  }

  /** @inheritdoc */
  countBatch(texts: readonly string[]) {
    return this.inner.countBatch(texts);
  }

  /** @inheritdoc */
  encode(text: string) {
    return this.inner.encode(text);
  }

  /** @inheritdoc */
  decode(tokens: number[]) {
    return this.inner.decode(tokens);
  }

  /** @inheritdoc */
  truncateToFit(text: string, maxTokens: number) {
    return this.inner.truncateToFit(text, maxTokens);
  }
}
