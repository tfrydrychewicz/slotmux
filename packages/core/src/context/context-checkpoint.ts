/**
 * Checkpoint / restore types for {@link Context.checkpoint} and {@link Context.restore} (§12.2 — Phase 9.3).
 *
 * @packageDocumentation
 */

import type { ContentItem } from '../types/content.js';

/**
 * Immutable snapshot of mutable {@link Context} slot contents at a point in time.
 *
 * - **`changedSincePrevious`** — delta encoding: only slot names whose serialized items differed from the
 *   prior checkpoint baseline (empty when nothing changed).
 * - **`slots`** — full copy of **every** registered slot (including unchanged empty slots), required for
 *   {@link Context.restore}.
 */
export type ContextCheckpoint = {
  readonly version: '1.0';

  /** Monotonic counter incremented on each {@link Context.checkpoint} call for this instance. */
  readonly seq: number;

  /** Slots whose item lists changed since the previous checkpoint on this context. */
  readonly changedSincePrevious: readonly string[];

  /** Full state: one entry per registered slot name. */
  readonly slots: Readonly<Record<string, readonly ContentItem[]>>;
};

/** JSON-clone items for checkpoint isolation and stable signatures. */
export function cloneItemsForCheckpoint(items: readonly ContentItem[]): ContentItem[] {
  return JSON.parse(JSON.stringify(items)) as ContentItem[];
}

/** Stable string for comparing slot contents between checkpoints. */
export function slotItemsSignature(items: readonly ContentItem[]): string {
  return JSON.stringify(items);
}
