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

/** Injectable LLM call (no network in package — app provides). */
export type ProgressiveSummarizeTextFn = (params: {
  readonly layer: ProgressiveLayer;
  readonly systemPrompt: string;
  readonly userPayload: string;
}) => Promise<string>;

export type ProgressivePrompts = {
  readonly layer1: string;
  readonly layer2: string;
  readonly layer3: string;
};
