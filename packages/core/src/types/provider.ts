/**
 * Provider adapter types for LLM integration.
 *
 * @packageDocumentation
 */

import type { TokenCount } from './branded.js';
import type { ProviderId, ModelId } from './config.js';
import type { CompiledMessage } from './content.js';

// ==========================================
// Tokenizer (for ProviderAdapter)
// ==========================================

/** Tokenizer interface — counts and encodes text for a specific model */
export interface Tokenizer {
  /** Unique identifier (e.g. 'cl100k_base', 'o200k_base') */
  readonly id: string;

  /** Count tokens in a string */
  count(text: string): TokenCount;

  /** Count tokens for a full message (includes role overhead, formatting) */
  countMessage(message: CompiledMessage): TokenCount;

  /** Count tokens for an array of messages (includes conversation overhead) */
  countMessages(messages: CompiledMessage[]): TokenCount;

  /** Encode text to token IDs */
  encode(text: string): number[];

  /** Decode token IDs to text */
  decode(tokens: number[]): string;

  /** Truncate text to fit within a token budget */
  truncateToFit(text: string, maxTokens: number): string;
}

// ==========================================
// Model Capabilities
// ==========================================

/** Model capabilities resolved from model identifier */
export interface ModelCapabilities {
  /** Maximum context window tokens */
  maxContextTokens: number;

  /** Maximum output tokens */
  maxOutputTokens: number;

  /** Supports function/tool calls */
  supportsFunctions: boolean;

  /** Supports vision (images) */
  supportsVision: boolean;

  /** Supports streaming */
  supportsStreaming: boolean;

  /** Tokenizer identifier for this model */
  tokenizerName: string;

  /** Cost per 1k input tokens (optional) */
  costPer1kInputTokens?: number;

  /** Cost per 1k output tokens (optional) */
  costPer1kOutputTokens?: number;
}

// ==========================================
// Provider Adapter
// ==========================================

/** Provider adapter — bridges core to LLM provider APIs */
export interface ProviderAdapter {
  /** Provider identifier */
  readonly id: ProviderId;

  /** Resolve model capabilities (maxTokens, tokenizer, etc.) */
  resolveModel(modelId: ModelId): ModelCapabilities;

  /** Format compiled messages for this provider's API */
  formatMessages(messages: readonly CompiledMessage[]): unknown;

  /** Get the appropriate tokenizer for a model */
  getTokenizer(modelId: ModelId): Tokenizer;

  /** Calculate token overhead for this provider */
  calculateOverhead(messages: readonly CompiledMessage[]): TokenCount;
}
