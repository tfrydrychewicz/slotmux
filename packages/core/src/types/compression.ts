/**
 * Compression strategy contracts (§8 / Phase 8.1).
 *
 * @packageDocumentation
 */

import type { Logger } from '../logging/logger.js';

import type { TokenCount } from './branded.js';
import type { OverflowConfig, SlotConfig } from './config.js';
import type { ContentItem } from './content.js';
import type { TokenCountCache } from './token-count-cache.js';

/**
 * Dependencies and metadata passed to {@link CompressionStrategy.compress}
 * (design §8.4).
 */
export interface CompressionContext {
  /** Slot being compressed. */
  readonly slotName: string;

  /** Full slot configuration (includes `overflow`, `overflowConfig`). */
  readonly slotConfig: Readonly<SlotConfig> | undefined;

  /** Shorthand for {@link SlotConfig.overflowConfig}. */
  readonly config: Readonly<OverflowConfig> | undefined;

  /** Same counter supplied to {@link PluginContext.tokenCounter} at install time. */
  readonly tokenCounter: TokenCountCache;

  /** Structured logger (maps from overflow `strategyLogger` when invoked via engine). */
  readonly logger: Logger;

  /**
   * When {@link OverflowConfig.anchorTo} is a `string` or {@link ContentItem}, a best-effort
   * text anchor; otherwise `undefined` (callers resolve `lastUserMessage` / `systemPrompt` themselves).
   */
  readonly anchorText: string | undefined;
}

/**
 * Named compressor registered via {@link PluginContext.registerCompressor} (§8.4).
 */
export interface CompressionStrategy {
  /** Must match the `name` passed to `registerCompressor(name, ...)`. */
  readonly name: string;

  compress(
    items: ContentItem[],
    budget: TokenCount,
    context: CompressionContext,
  ): ContentItem[] | Promise<ContentItem[]>;
}
