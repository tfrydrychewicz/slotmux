/**
 * Security-related defaults (§19.1 — Phase 13.1).
 *
 * @packageDocumentation
 */

import type { SlotConfig } from '../types/config.js';

/** Default {@link SlotConfig.maxItems} when omitted — caps per-slot item count (memory exhaustion). */
export const DEFAULT_SLOT_MAX_ITEMS = 10_000;

/** Ratio of {@link SlotConfig.maxItems} at which {@link ContentStore} emits a one-time approaching-limit signal. */
export const SLOT_ITEMS_WARN_THRESHOLD_RATIO = 0.8;

/**
 * Effective max items for a slot: explicit {@link SlotConfig.maxItems} or {@link DEFAULT_SLOT_MAX_ITEMS}.
 */
export function effectiveSlotMaxItems(slot: SlotConfig): number {
  return slot.maxItems ?? DEFAULT_SLOT_MAX_ITEMS;
}

/**
 * Item count at which to warn once (first time length reaches this value after an append).
 * At least `1` so tiny caps still get a warning.
 */
export function slotItemsNearLimitThreshold(maxItems: number): number {
  return Math.max(1, Math.floor(maxItems * SLOT_ITEMS_WARN_THRESHOLD_RATIO));
}
