/**
 * Named overflow strategy presets for `SlotConfig.overflow` (design §5.2, §6.2).
 *
 * @packageDocumentation
 */

/**
 * String presets matching built-in `SlotOverflowStrategy` names (`slotmux` type).
 * Use these instead of raw strings for autocomplete and refactors.
 *
 * @example
 * ```ts
 * import { SlotOverflow } from 'slotmux';
 * slots: {
 *   history: { priority: 50, budget: { flex: true }, overflow: SlotOverflow.SUMMARIZE },
 * }
 * ```
 */
export const SlotOverflow = {
  TRUNCATE: 'truncate',
  TRUNCATE_LATEST: 'truncate-latest',
  SUMMARIZE: 'summarize',
  SLIDING_WINDOW: 'sliding-window',
  SEMANTIC: 'semantic',
  COMPRESS: 'compress',
  ERROR: 'error',
  FALLBACK_CHAIN: 'fallback-chain',
} as const;

/** Union of all {@link SlotOverflow} string values (excludes custom overflow functions). */
export type SlotOverflowPreset = (typeof SlotOverflow)[keyof typeof SlotOverflow];
