/**
 * Provider factory types and utilities for auto-wired LLM capabilities (§10.3).
 *
 * Provider factories extend adapters with the ability to **call** the provider
 * for auxiliary tasks (summarization for overflow, embeddings for semantic compression).
 *
 * @packageDocumentation
 */

import type { ProviderAdapter } from 'slotmux';

/**
 * A function that calls an LLM to summarize text.
 * Receives the compression layer, a system prompt, and the user payload.
 * Returns the summarized text.
 */
export type SummarizeTextFn = (params: {
  readonly layer: 1 | 2 | 3;
  readonly systemPrompt: string;
  readonly userPayload: string;
}) => Promise<string>;

/**
 * Map-reduce summarization dependencies for bulk content compression.
 * Matches the `MapReduceSummarizeDeps` shape from `@slotmux/compression`.
 */
export type MapReduceDeps = {
  readonly mapChunk: (params: { readonly systemPrompt: string; readonly userPayload: string }) => Promise<string>;
  readonly reduceMerge: (params: { readonly systemPrompt: string; readonly userPayload: string }) => Promise<string>;
  readonly mapChunkMaxInputTokens?: number;
};

/**
 * Bundles a provider adapter with optional LLM call capabilities.
 *
 * When passed to `createContext({ slotmuxProvider })`, the orchestrator
 * auto-wires summarization and embeddings into the overflow engine.
 *
 * @example
 * ```typescript
 * import { openai } from '@slotmux/providers';
 *
 * createContext({
 *   model: 'gpt-5.4',
 *   preset: 'chat',
 *   slotmuxProvider: openai({ apiKey: process.env.OPENAI_API_KEY }),
 * });
 * ```
 */
export type SlotmuxProvider = {
  readonly adapter: ProviderAdapter;
  readonly summarizeText?: SummarizeTextFn;
  readonly mapReduce?: MapReduceDeps;
  readonly embed?: (text: string) => Promise<number[]>;
};

/**
 * Base options accepted by all provider factories.
 */
export type SlotmuxProviderOptions = {
  /** API key for the provider. */
  readonly apiKey: string;

  /**
   * Model used for compression/summarization calls.
   * Defaults to a cheap variant for each provider.
   */
  readonly compressionModel?: string;

  /**
   * Base URL override for the provider API.
   * Useful for proxies, Azure OpenAI, or self-hosted instances.
   */
  readonly baseUrl?: string;

  /**
   * Custom summarize function. When provided, the factory skips
   * auto-creating one from the provider API.
   */
  readonly summarize?: (systemPrompt: string, userMessage: string) => Promise<string>;

  /**
   * Custom embedding function. When provided, the factory uses it
   * for semantic overflow instead of the provider's embedding API.
   */
  readonly embed?: (text: string) => Promise<number[]>;
};

/**
 * Creates a `SummarizeTextFn` from a simple `(system, user) => text` function.
 *
 * @internal
 */
export function wrapCustomSummarize(
  fn: (systemPrompt: string, userMessage: string) => Promise<string>,
): SummarizeTextFn {
  return async ({ systemPrompt, userPayload }) => fn(systemPrompt, userPayload);
}
