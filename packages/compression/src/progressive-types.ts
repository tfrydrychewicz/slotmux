/**
 * Types for progressive summarization (design §8.1).
 *
 * @packageDocumentation
 */

import type { LosslessCompressibleItem } from './lossless-types.js';

/** Compression layer: 1 key points, 2 executive, 3 essence. */
export type ProgressiveLayer = 1 | 2 | 3;

/**
 * Message shape for progressive summarize — structurally compatible with `slotmux` `ContentItem`.
 */
export type ProgressiveItem = LosslessCompressibleItem & {
  readonly id: string;
  readonly createdAt: number;
  readonly pinned?: boolean;
  readonly summarizes?: readonly string[];
  readonly slot?: string;
};

/**
 * Optional metadata returned alongside summarized text.
 *
 * Provider implementations may return this instead of a plain `string`
 * to surface diagnostic information (finish reason, HTTP status) to
 * callers and logging wrappers. Consumers that only need the text
 * should use {@link extractSummarizeText}.
 */
export type SummarizeTextResult = {
  readonly text: string;
  readonly finishReason?: string | null;
  readonly httpStatus?: number | null;
};

/**
 * Extracts the plain text from a summarize result, whether it is a
 * raw `string` or a {@link SummarizeTextResult} object.
 */
export function extractSummarizeText(result: string | SummarizeTextResult): string {
  return typeof result === 'string' ? result : result.text;
}

/**
 * Injectable LLM call (no network in package — app provides).
 *
 * Implementations may return a plain `string` or a {@link SummarizeTextResult}
 * with optional diagnostic metadata (`finishReason`, `httpStatus`).
 *
 * @param params.layer - Compression layer (1 = key points, 2 = executive, 3 = essence).
 * @param params.systemPrompt - System prompt (may include a target-length instruction).
 * @param params.userPayload - Conversation text to summarize.
 * @param params.targetTokens - Approximate token budget for the summary output.
 *   Implementations may use this to set `max_tokens` or guide output length.
 *   Optional for backward compatibility.
 */
export type ProgressiveSummarizeTextFn = (params: {
  readonly layer: ProgressiveLayer;
  readonly systemPrompt: string;
  readonly userPayload: string;
  readonly targetTokens?: number;
  /**
   * When set, the provider should request structured JSON output (§8.4.1a).
   * The caller falls back to text parsing if JSON response parsing fails.
   */
  readonly responseSchema?: Record<string, unknown>;
}) => Promise<string | SummarizeTextResult>;

export type ProgressivePrompts = {
  readonly layer1: string;
  readonly layer2: string;
  readonly layer3: string;
};
