/**
 * Token counting for overflow strategies and the build pipeline (Phase 4.2+).
 *
 * @packageDocumentation
 */

import type { ContentItem } from './content.js';

/**
 * Provides consistent token totals for {@link ContentItem} lists.
 * The orchestrator / {@link OverflowEngine} injects a real implementation;
 * strategies fall back to {@link sumCachedItemTokens} when omitted.
 */
export interface TokenAccountant {
  /** Non-negative total tokens for the given ordered items. */
  countItems(items: readonly ContentItem[]): number;
}
