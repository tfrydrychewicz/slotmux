/**
 * Plugin types for contextcraft extensibility.
 *
 * @packageDocumentation
 */

import type { TokenCount } from './branded.js';
import type { SlotConfig, OverflowStrategyFn } from './config.js';
import type { ContentItem, CompiledMessage } from './content.js';
import type { ContextEvent } from './events.js';
import type { ContextSnapshot } from './snapshot.js';

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
// Plugin Context Dependencies (placeholders)
// ==========================================

/** Token count cache — counts tokens for content with caching */
export interface TokenCountCache {
  /** Count tokens for content */
  count(content: string): TokenCount;
}

/** Compression strategy — compresses content to fit budget */
export interface CompressionStrategy {
  /** Compress items to fit within budget */
  compress(
    items: ContentItem[],
    budget: TokenCount,
    context: { slot: string; [key: string]: unknown },
  ): ContentItem[] | Promise<ContentItem[]>;
}

/** Logger interface for plugin logging */
export interface PluginLogger {
  /** Log info message */
  info(message: string, ...args: unknown[]): void;

  /** Log warning */
  warn(message: string, ...args: unknown[]): void;

  /** Log error */
  error(message: string, ...args: unknown[]): void;

  /** Log debug message */
  debug?(message: string, ...args: unknown[]): void;
}

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

  /** Called before budget resolution */
  beforeBudgetResolve?(
    slots: SlotConfig[],
  ): SlotConfig[] | Promise<SlotConfig[]>;

  /** Called after budget resolution, before overflow */
  afterBudgetResolve?(slots: ResolvedSlot[]): void | Promise<void>;

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
