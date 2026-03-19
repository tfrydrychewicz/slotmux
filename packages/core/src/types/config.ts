/**
 * Configuration types for context and slot setup.
 *
 * @packageDocumentation
 */

import type { TokenCount } from './branded.js';
import type { ContentItem, MessageRole } from './content.js';
import type { ContextEvent } from './events.js';

// Re-export content and event types for consumers that import from config
export type { ContentItem, MessageRole } from './content.js';
export type { ContextEvent } from './events.js';

// ==========================================
// Supporting Types (forward refs / placeholders)
// ==========================================

/** Supported LLM provider identifiers */
export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'mistral'
  | 'ollama'
  | 'custom';

/** Model identifier — either a known model string or custom config */
export type ModelId = string;

/**
 * Context plugin (placeholder).
 * Full interface in Phase 1.6.
 */
export interface ContextPlugin {
  install?(): void | Promise<void>;
  [key: string]: unknown;
}

// ==========================================
// Slot Budget
// ==========================================

/** Fixed token count allocation */
export interface SlotBudgetFixed {
  fixed: number;
}

/** Percentage of available budget (after fixed slots) */
export interface SlotBudgetPercent {
  percent: number;
}

/** Fills remaining space */
export interface SlotBudgetFlex {
  flex: true;
}

/** Flex with min/max bounds */
export interface SlotBudgetBoundedFlex {
  min: number;
  max: number;
  flex: true;
}

/** Slot budget allocation — discriminated union */
export type SlotBudget =
  | SlotBudgetFixed
  | SlotBudgetPercent
  | SlotBudgetFlex
  | SlotBudgetBoundedFlex;

// ==========================================
// Overflow Strategy
// ==========================================

/** Context passed to custom overflow strategy functions */
export interface OverflowContext {
  /** Slot name */
  readonly slot: string;
  /** Additional context for the strategy */
  readonly [key: string]: unknown;
}

/** Custom overflow strategy function */
export type OverflowStrategyFn = (
  items: ContentItem[],
  budget: TokenCount,
  context: OverflowContext,
) => ContentItem[] | Promise<ContentItem[]>;

/** Summarizer function for summarize overflow strategy */
export type SummarizerFn = (
  items: ContentItem[],
  budget: TokenCount,
) => ContentItem[] | Promise<ContentItem[]>;

/** Named overflow strategies plus custom function */
export type SlotOverflowStrategy =
  | 'truncate'
  | 'truncate-latest'
  | 'summarize'
  | 'sliding-window'
  | 'semantic'
  | 'compress'
  | 'error'
  | OverflowStrategyFn;

// ==========================================
// Overflow Config
// ==========================================

/** Configuration for overflow strategies */
export interface OverflowConfig {
  /** Summarizer implementation (summarize strategy) */
  summarizer?:
    | 'builtin:progressive'
    | 'builtin:map-reduce'
    | SummarizerFn;
  /** Number of recent messages to always preserve from summarization */
  preserveLastN?: number;
  /** What portion of the slot budget the summary itself may consume */
  summaryBudget?: SlotBudget;
  /** Minimum number of messages before summarization triggers */
  summarizeThreshold?: number;

  /** Minimum similarity score to retain content 0.0–1.0 (semantic strategy) */
  similarityThreshold?: number;
  /** What content to score relevance against (semantic strategy) */
  anchorTo?: 'lastUserMessage' | 'systemPrompt' | ContentItem | string;
  /** Embedding function (semantic strategy) */
  embedFn?: (text: string) => Promise<number[]>;

  /** Number of items to keep (sliding-window strategy) */
  windowSize?: number;

  /** Compression level 0.0–1.0 (compress strategy) */
  compressionLevel?: number;
}

// ==========================================
// Slot Config
// ==========================================

/** Configuration for a single slot */
export interface SlotConfig {
  /** Priority 1–100. Higher priority slots are preserved during overflow. */
  priority: number;

  /** Budget allocation for this slot */
  budget: SlotBudget;

  /** Strategy when content exceeds budget */
  overflow?: SlotOverflowStrategy;

  /** Configuration specific to the chosen overflow strategy */
  overflowConfig?: OverflowConfig;

  /** If true, this slot's content is prepended to the message array (before history) */
  position?: 'before' | 'after' | 'interleave';

  /** Custom ordering weight when position is 'interleave' */
  order?: number;

  /** Maximum number of content items (independent of token budget) */
  maxItems?: number;

  /** Content in this slot is exempt from all overflow (use with extreme caution) */
  protected?: boolean;

  /** Role to assign messages in this slot (for provider formatting) */
  defaultRole?: MessageRole;
}

// ==========================================
// Provider & Tokenizer Config
// ==========================================

/** Provider-specific adapter configuration */
export interface ProviderConfig {
  /** Provider identifier override */
  provider?: ProviderId;
  /** API base URL override */
  baseUrl?: string;
  /** Additional provider-specific options */
  [key: string]: unknown;
}

/** Token counting strategy configuration */
export interface TokenizerConfig {
  /** Tokenizer identifier (e.g. 'cl100k_base', 'o200k_base') */
  name?: string;
  /** Enable token count caching (default: true) */
  cache?: boolean;
}

// ==========================================
// Context Config
// ==========================================

/** Root configuration for context creation */
export interface ContextConfig {
  /** Model identifier — used to infer tokenizer, maxTokens, and provider */
  model: ModelId;

  /** Tokens reserved for the model's response (not part of the context budget) */
  reserveForResponse?: number;

  /** Maximum tokens for the entire context. Auto-detected from model if omitted. */
  maxTokens?: number;

  /** Slot definitions. If omitted, a default slot layout is used. */
  slots?: Record<string, SlotConfig>;

  /** Provider-specific adapter configuration */
  provider?: ProviderConfig;

  /** Plugin instances to activate */
  plugins?: ContextPlugin[];

  /** Event handler for observability */
  onEvent?: (event: ContextEvent) => void;

  /** Enable immutable snapshots (default: true). Disable for performance. */
  immutableSnapshots?: boolean;

  /** Token counting strategy */
  tokenizer?: TokenizerConfig;
}
