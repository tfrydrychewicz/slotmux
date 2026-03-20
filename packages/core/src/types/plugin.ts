/**
 * Plugin types for contextcraft extensibility.
 *
 * @packageDocumentation
 */

import type { Logger } from '../logging/logger.js';
import type { ContextSnapshot } from '../snapshot/context-snapshot.js';

import type { CompressionStrategy } from './compression.js';
import type { OverflowStrategyFn, SlotConfig } from './config.js';
import type { ContentItem, CompiledMessage } from './content.js';
import type { ContextEvent } from './events.js';
import type { TokenCountCache } from './token-count-cache.js';

// ==========================================
// Resolved Slot
// ==========================================

/** Slot with resolved budget (after budget resolution, before overflow) */
export interface ResolvedSlot {
  /** Slot name */
  name: string;

  /** Slot priority (1–100) */
  priority: number;

  /** Resolved token budget */
  budgetTokens: number;

  /** Content items in the slot */
  content: ContentItem[];
}

// ==========================================
// Plugin Context Dependencies
// ==========================================

export type { CompressionStrategy } from './compression.js';
export type { TokenCountCache } from './token-count-cache.js';

/** Plugin-facing logger — same shape as {@link Logger} (§13.3 / Phase 7.3). */
export type PluginLogger = Logger;

// ==========================================
// Plugin Context
// ==========================================

/** Context provided to plugins during install and lifecycle hooks */
export interface PluginContext {
  /** Read current slot configurations */
  getSlots(): Record<string, SlotConfig>;

  /** Access token counter */
  tokenCounter: TokenCountCache;

  /** Register a custom overflow strategy */
  registerOverflowStrategy(name: string, strategy: OverflowStrategyFn): void;

  /** Register a custom compression strategy */
  registerCompressor(name: string, compressor: CompressionStrategy): void;

  /** Logger scoped to this plugin */
  logger: PluginLogger;
}

// ==========================================
// Context Plugin
// ==========================================

/** Plugin interface with all lifecycle hooks */
export interface ContextPlugin {
  /** Unique plugin name */
  readonly name: string;

  /** Plugin version (semver) */
  readonly version: string;

  /** Called once when the plugin is registered */
  install?(ctx: PluginContext): void | Promise<void>;

  /**
   * Run during {@link createContext} after preset / slot resolution, before validation.
   * Use to inject default slots when absent (e.g. RAG `rag` slot).
   */
  prepareSlots?(slots: Record<string, SlotConfig>): Record<string, SlotConfig>;

  /** Called before budget resolution */
  beforeBudgetResolve?(
    slots: SlotConfig[],
  ): SlotConfig[] | Promise<SlotConfig[]>;

  /** Called after budget resolution, before overflow */
  afterBudgetResolve?(slots: readonly ResolvedSlot[]): void | Promise<void>;

  /** Called before overflow strategy executes for a slot */
  beforeOverflow?(
    slot: string,
    items: ContentItem[],
  ): ContentItem[] | Promise<ContentItem[]>;

  /** Called after overflow resolution */
  afterOverflow?(
    slot: string,
    items: ContentItem[],
    evicted: ContentItem[],
  ): void | Promise<void>;

  /** Called before the final snapshot is produced */
  beforeSnapshot?(
    messages: CompiledMessage[],
  ): CompiledMessage[] | Promise<CompiledMessage[]>;

  /** Called after the snapshot is produced (read-only) */
  afterSnapshot?(snapshot: ContextSnapshot): void | Promise<void>;

  /** Called when content is added to any slot */
  onContentAdded?(slot: string, item: ContentItem): void | Promise<void>;

  /** Called on any event */
  onEvent?(event: ContextEvent): void;

  /** Cleanup */
  destroy?(): void | Promise<void>;
}
