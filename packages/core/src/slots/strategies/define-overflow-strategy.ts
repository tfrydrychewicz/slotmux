/**
 * Factory for user-defined overflow strategies (§8.4 — Phase 4.6).
 *
 * @packageDocumentation
 */

import type { TokenCount } from '../../types/branded.js';
import type {
  OverflowContext,
  OverflowStrategyFn,
  OverflowStrategyLogger,
  SlotConfig,
} from '../../types/config.js';
import type { ContentItem } from '../../types/content.js';
import type { TokenAccountant } from '../../types/token-accountant.js';

/** Arguments passed to {@link defineOverflowStrategy} implementations. */
export type OverflowStrategyImplementationArgs = {
  readonly items: ContentItem[];
  readonly budget: TokenCount;
  /** Full {@link OverflowContext} (includes extension keys). */
  readonly context: OverflowContext;
  /** {@link OverflowContext.slotName} or {@link OverflowContext.slot}. */
  readonly slotName: string;
  readonly slotConfig: SlotConfig | undefined;
  /** Same as {@link OverflowContext.tokenAccountant} (plan name: token counter for items). */
  readonly tokenCounter: TokenAccountant | undefined;
  readonly logger: OverflowStrategyLogger | undefined;
};

export type OverflowStrategyImplementation = (
  args: OverflowStrategyImplementationArgs,
) => ContentItem[] | Promise<ContentItem[]>;

/**
 * Wraps a structured handler as an {@link OverflowStrategyFn} for `SlotConfig.overflow`.
 *
 * Injects {@link OverflowStrategyImplementationArgs.slotName}, `slotConfig`, `tokenCounter`,
 * and `logger` from {@link OverflowContext} for ergonomic custom strategies.
 */
export function defineOverflowStrategy(
  impl: OverflowStrategyImplementation,
): OverflowStrategyFn {
  return (items, budget, context) => {
    const slotName =
      context.slotName !== undefined && context.slotName !== ''
        ? context.slotName
        : context.slot;
    const slotConfig = context.slotConfig;
    const tokenCounter = context.tokenAccountant;
    const logger = context.logger;
    return Promise.resolve(
      impl({
        items,
        budget,
        context,
        slotName,
        slotConfig,
        tokenCounter,
        logger,
      }),
    );
  };
}

/**
 * Alias for {@link defineOverflowStrategy} (implementation plan §4.6).
 * Names “compression” historically; this builds **slot overflow** handlers only.
 */
export const defineCompressionStrategy = defineOverflowStrategy;
