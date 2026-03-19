/**
 * Snapshot types for compiled context state.
 *
 * @packageDocumentation
 */

import type { TokenCount } from './branded.js';
import type { ProviderId, ModelId } from './config.js';
import type { CompiledMessage, ContentItem } from './content.js';

// ==========================================
// Slot Meta
// ==========================================

/** Per-slot metadata in a snapshot */
export interface SlotMeta {
  /** Slot name */
  name: string;

  /** Resolved budget in tokens */
  budgetTokens: TokenCount;

  /** Actual tokens used */
  usedTokens: TokenCount;

  /** Number of content items in the slot */
  itemCount: number;

  /** Number of items evicted during overflow */
  evictedCount: number;

  /** Whether overflow strategy was triggered */
  overflowTriggered: boolean;

  /** Utilization of this slot (usedTokens / budgetTokens) */
  utilization: number;
}

// ==========================================
// Compression & Eviction Events
// ==========================================

/** Compression event that occurred during build */
export interface CompressionEvent {
  /** Slot where compression occurred */
  slot: string;

  /** Tokens before compression */
  beforeTokens: number;

  /** Tokens after compression */
  afterTokens: number;

  /** Number of items compressed */
  itemCount: number;

  /** Compression ratio (1 - afterTokens/beforeTokens) */
  ratio?: number;
}

/** Content evicted during overflow resolution */
export interface EvictionEvent {
  /** Slot from which content was evicted */
  slot: string;

  /** The evicted content item */
  item: ContentItem;

  /** Reason for eviction */
  reason: string;
}

// ==========================================
// Context Warning
// ==========================================

/** Warning emitted during build */
export interface ContextWarning {
  /** Warning code */
  code: string;

  /** Human-readable message */
  message: string;

  /** Slot involved (if applicable) */
  slot?: string;

  /** Severity level */
  severity: 'info' | 'warn' | 'error';
}

// ==========================================
// Snapshot Meta
// ==========================================

/** Comprehensive metadata about a compiled snapshot */
export interface SnapshotMeta {
  /** Total tokens used in this snapshot */
  totalTokens: TokenCount;

  /** Total token budget available (maxTokens - reserveForResponse) */
  totalBudget: TokenCount;

  /** Utilization ratio (0.0–1.0) */
  utilization: number;

  /** Wasted budget (allocated but unused tokens across all slots) */
  waste: TokenCount;

  /** Per-slot breakdown */
  slots: Record<string, SlotMeta>;

  /** Compression events that occurred during this build */
  compressions: CompressionEvent[];

  /** Content items evicted during overflow resolution */
  evictions: EvictionEvent[];

  /** Warnings (e.g., slot over budget but protected, near-overflow) */
  warnings: ContextWarning[];

  /** Time taken to compile this snapshot (milliseconds) */
  buildTimeMs: number;

  /** Timestamp */
  builtAt: number;
}

// ==========================================
// Snapshot Diff
// ==========================================

/** Diff result between two snapshots */
export interface SnapshotDiff {
  /** Messages added in the newer snapshot */
  added: readonly CompiledMessage[];

  /** Messages removed from the older snapshot */
  removed: readonly CompiledMessage[];

  /** Messages modified (same position, different content) */
  modified: Array<{
    index: number;
    before: CompiledMessage;
    after: CompiledMessage;
  }>;
}

// ==========================================
// Serialized Snapshot
// ==========================================

/** Serialized slot metadata (JSON-safe) */
export type SerializedSlot = SlotMeta;

/** Serialized message (JSON-safe, same structure as CompiledMessage) */
export type SerializedMessage = CompiledMessage;

/** Serializable snapshot format for persistence */
export interface SerializedSnapshot {
  /** Schema version */
  version: '1.0';

  /** Snapshot identifier */
  id: string;

  /** Model identifier */
  model: ModelId;

  /** Slot metadata */
  slots: Record<string, SerializedSlot>;

  /** Compiled messages */
  messages: SerializedMessage[];

  /** Snapshot metadata */
  meta: SnapshotMeta;

  /** SHA-256 checksum for integrity verification */
  checksum: string;
}

// ==========================================
// Context Snapshot
// ==========================================

/** Immutable compiled context ready for LLM consumption */
export interface ContextSnapshot {
  /** Unique snapshot identifier */
  readonly id: string;

  /** The compiled messages, ready for LLM consumption */
  readonly messages: readonly CompiledMessage[];

  /** Comprehensive metadata about this compilation */
  readonly meta: SnapshotMeta;

  /** Format messages for a specific provider */
  format(provider: ProviderId): unknown;

  /** Export to a serializable format */
  serialize(): SerializedSnapshot;

  /** Diff against another snapshot */
  diff(other: ContextSnapshot): SnapshotDiff;
}
