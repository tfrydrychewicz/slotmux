/**
 * Mistral AI chat adapter (Phase 6.6, §10).
 *
 * Mistral’s Chat Completions API uses an OpenAI-compatible `messages` shape; we reuse
 * {@link formatOpenAIMessages} and expose Mistral-specific names for clarity.
 *
 * @packageDocumentation
 */

import {
  Cl100kTokenizer,
  FallbackTokenizer,
  O200kTokenizer,
} from '@contextcraft/tokenizers';
import {
  BaseProviderAdapter,
  type CompiledMessage,
  type ModelId,
  type Tokenizer,
} from 'contextcraft';

import {
  formatOpenAIMessages,
  type OpenAIChatCompletionMessage,
} from './openai-adapter.js';

/**
 * Entries for Mistral `POST /v1/chat/completions` `messages` (OpenAI-compatible).
 */
export type MistralChatMessage = OpenAIChatCompletionMessage;

/**
 * Format compiled messages for Mistral chat `messages`.
 */
export function formatMistralMessages(
  messages: readonly CompiledMessage[],
): MistralChatMessage[] {
  return formatOpenAIMessages(messages);
}

const tokenizerKey = (name: string): 'cl100k_base' | 'o200k_base' =>
  name === 'cl100k_base' ? 'cl100k_base' : 'o200k_base';

/**
 * Mistral provider adapter — registry-backed caps, tiktoken-backed counting (with fallback).
 */
export class MistralAdapter extends BaseProviderAdapter {
  private readonly tokenizerByEncoding = new Map<
    'cl100k_base' | 'o200k_base',
    Tokenizer
  >();

  constructor() {
    super('mistral');
  }

  /** @inheritdoc */
  override getTokenizer(modelId: ModelId): Tokenizer {
    const enc = tokenizerKey(this.resolveModel(modelId).tokenizerName);
    let tok = this.tokenizerByEncoding.get(enc);
    if (tok === undefined) {
      tok =
        enc === 'cl100k_base'
          ? new FallbackTokenizer(() => new Cl100kTokenizer())
          : new FallbackTokenizer(() => new O200kTokenizer());
      this.tokenizerByEncoding.set(enc, tok);
    }
    return tok;
  }

  /** @inheritdoc */
  override formatMessages(
    messages: readonly CompiledMessage[],
  ): MistralChatMessage[] {
    return formatMistralMessages(messages);
  }
}

/** Convenience factory. */
export function createMistralAdapter(): MistralAdapter {
  return new MistralAdapter();
}
