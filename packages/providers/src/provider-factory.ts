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
 * Optional metadata returned alongside summarized text.
 *
 * Structurally identical to `@slotmux/compression`'s `SummarizeTextResult` —
 * both packages use structural typing for compatibility without circular imports.
 */
export type SummarizeTextResult = {
  readonly text: string;
  readonly finishReason?: string | null;
  readonly httpStatus?: number | null;
};

/**
 * A function that calls an LLM to summarize text.
 * Receives the compression layer, a system prompt, and the user payload.
 *
 * May return a plain `string` or a {@link SummarizeTextResult} with
 * optional diagnostic metadata (`finishReason`, `httpStatus`).
 *
 * @param params.targetTokens - Approximate token budget for the summary output.
 *   Used by the progressive summarizer to append a target-length instruction to the
 *   system prompt. Providers should **not** pass this as a hard API output limit
 *   (`max_completion_tokens`, `max_tokens`, etc.) — doing so causes models to
 *   return empty content when the budget is tight. Let the model self-regulate
 *   output length via the prompt instruction.
 */
export type SummarizeTextFn = (params: {
  readonly layer: 1 | 2 | 3;
  readonly systemPrompt: string;
  readonly userPayload: string;
  readonly targetTokens?: number;
}) => Promise<string | SummarizeTextResult>;

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

  /**
   * Maximum retry attempts for HTTP 429 (rate limit) responses.
   * Retries are coordinated across concurrent calls by an adaptive rate
   * limiter that automatically reduces parallelism on 429s (AIMD).
   * @defaultValue 5
   */
  readonly maxRetries?: number;
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
