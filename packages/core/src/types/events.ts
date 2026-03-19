/**
 * Event types for context observability.
 *
 * @packageDocumentation
 */

import type { ContextSnapshot } from '../snapshot/context-snapshot.js';

import type { ContentItem } from './content.js';
import type { ContextWarning } from './snapshot.js';

// ==========================================
// Context Event (Discriminated Union)
// ==========================================

/** Content was added to a slot */
export interface ContentAddedEvent {
  readonly type: 'content:added';
  readonly slot: string;
  readonly item: ContentItem;
}

/** Content was evicted during overflow */
export interface ContentEvictedEvent {
  readonly type: 'content:evicted';
  readonly slot: string;
  readonly item: ContentItem;
  readonly reason: string;
}

/** Content was pinned (exempt from overflow) */
export interface ContentPinnedEvent {
  readonly type: 'content:pinned';
  readonly slot: string;
  readonly item: ContentItem;
}

/** Slot overflow was triggered */
export interface SlotOverflowEvent {
  readonly type: 'slot:overflow';
  readonly slot: string;
  readonly strategy: string;
  readonly beforeTokens: number;
  readonly afterTokens: number;
}

/** Slot budget was resolved */
export interface SlotBudgetResolvedEvent {
  readonly type: 'slot:budget-resolved';
  readonly slot: string;
  readonly budgetTokens: number;
}

/** Compression started */
export interface CompressionStartEvent {
  readonly type: 'compression:start';
  readonly slot: string;
  readonly itemCount: number;
}

/** Compression completed */
export interface CompressionCompleteEvent {
  readonly type: 'compression:complete';
  readonly slot: string;
  readonly beforeTokens: number;
  readonly afterTokens: number;
  readonly ratio: number;
}

/** Build started */
export interface BuildStartEvent {
  readonly type: 'build:start';
  readonly totalBudget: number;
}

/** Build completed */
export interface BuildCompleteEvent {
  readonly type: 'build:complete';
  readonly snapshot: ContextSnapshot;
}

/** Warning emitted during build */
export interface WarningEvent {
  readonly type: 'warning';
  readonly warning: ContextWarning;
}

/** Discriminated union of all context events */
export type ContextEvent =
  | ContentAddedEvent
  | ContentEvictedEvent
  | ContentPinnedEvent
  | SlotOverflowEvent
  | SlotBudgetResolvedEvent
  | CompressionStartEvent
  | CompressionCompleteEvent
  | BuildStartEvent
  | BuildCompleteEvent
  | WarningEvent;
