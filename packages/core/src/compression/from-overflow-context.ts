/**
 * Build {@link CompressionContext} from {@link OverflowContext} (Phase 8.1).
 *
 * @packageDocumentation
 */

import type { Logger } from '../logging/logger.js';
import type { CompressionContext } from '../types/compression.js';
import type { OverflowConfig, OverflowContext } from '../types/config.js';
import type { ContentItem } from '../types/content.js';
import type { TokenCountCache } from '../types/token-count-cache.js';

/**
 * Maps {@link OverflowContext.logger} into a {@link Logger} for compressors.
 */
export function overflowStrategyLoggerToLogger(
  log: OverflowContext['logger'],
): Logger {
  return {
    trace: (message, ...args) => {
      log?.trace?.(message, ...args);
    },
    debug: (message, ...args) => {
      log?.debug?.(message, ...args);
    },
    info: (message, ...args) => {
      log?.info(message, ...args);
    },
    warn: (message, ...args) => {
      log?.warn(message, ...args);
    },
    error: (message, ...args) => {
      log?.error(message, ...args);
    },
  };
}

function anchorTextFromOverflowConfig(
  overflowConfig: Readonly<OverflowConfig> | undefined,
): string | undefined {
  if (overflowConfig?.anchorTo === undefined) {
    return undefined;
  }
  const a = overflowConfig.anchorTo;
  if (typeof a === 'string') {
    return a;
  }
  if (typeof a === 'object' && a !== null && 'content' in a) {
    const c = (a as ContentItem).content;
    return typeof c === 'string' ? c : undefined;
  }
  return undefined;
}

export type CompressionContextFromOverflowDeps = {
  readonly tokenCounter: TokenCountCache;
  /** Used when {@link OverflowContext.logger} is missing. */
  readonly fallbackLogger: Logger;
};

/**
 * Materializes {@link CompressionContext} for a compressor running inside {@link OverflowEngine}.
 */
export function compressionContextFromOverflow(
  overflow: OverflowContext,
  deps: CompressionContextFromOverflowDeps,
): CompressionContext {
  const slotName =
    overflow.slotName !== undefined && overflow.slotName !== ''
      ? overflow.slotName
      : overflow.slot;

  return {
    slotName,
    slotConfig: overflow.slotConfig,
    config: overflow.slotConfig?.overflowConfig,
    tokenCounter: deps.tokenCounter,
    logger:
      overflow.logger !== undefined
        ? overflowStrategyLoggerToLogger(overflow.logger)
        : deps.fallbackLogger,
    anchorText: anchorTextFromOverflowConfig(overflow.slotConfig?.overflowConfig),
  };
}
