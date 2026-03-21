/**
 * Configuration types for context and slot setup.
 *
 * @packageDocumentation
 */

import type { LogLevel, Logger } from '../logging/logger.js';
import type { RedactionOptions } from '../logging/redact.js';

import type { TokenCount } from './branded.js';
import type { ContentItem, MessageRole } from './content.js';
import type { ContextEvent } from './events.js';
import type { ContextPlugin } from './plugin.js';
import type { SlotmuxProvider } from './provider.js';
import type { TokenAccountant } from './token-accountant.js';

// Re-export content, event, and plugin types for consumers that import from config
export type { ContentItem, MessageRole } from './content.js';
export type { ContextEvent } from './events.js';
export type { ContextPlugin } from './plugin.js';

// ==========================================
// Supporting Types
// ==========================================

/** Supported LLM provider identifiers */
export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'mistral'
  | 'ollama'
  | 'custom';

/**
 * Targets for {@link ContextSnapshot.format}: LLM providers plus plain-text export (§6.4).
 */
export type SnapshotFormatTarget = ProviderId | 'text';

/** Model identifier — either a known model string or custom config */
export type ModelId = string;

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

/**
 * Logger optionally passed to custom overflow strategies via
 * {@link OverflowEngineOptions.strategyLogger}.
 */
export interface OverflowStrategyLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
  trace?(message: string, ...args: unknown[]): void;
}

/** Context passed to custom overflow strategy functions */
export interface OverflowContext {
  /** Slot name */
  readonly slot: string;
  /**
   * Same as {@link slot}. Set by {@link OverflowEngine} for ergonomic destructuring
   * (§8.4).
   */
  readonly slotName?: string;
  /**
   * Injected by {@link OverflowEngine} / orchestrator so strategies use the same
   * counter as the rest of the build. Omitted in standalone strategy calls.
   */
  readonly tokenAccountant?: TokenAccountant;
  /**
   * Per-slot config when invoked from {@link OverflowEngine} (includes
   * `overflowConfig`, e.g. `windowSize`).
   */
  readonly slotConfig?: SlotConfig;
  /** Optional logger from {@link OverflowEngineOptions.strategyLogger}. */
  readonly logger?: OverflowStrategyLogger;
  /**
   * When using `overflow: 'semantic'` with `overflowConfig.anchorTo: 'systemPrompt'`, set this
   * on the context (e.g. from the orchestrator) so the anchor text is available.
   */
  readonly systemPrompt?: string;
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

/**
 * Named overflow strategies plus custom function.
 * Use the {@link SlotOverflow} export for built-in name literals (§8.6).
 */
export type SlotOverflowStrategy =
  | 'truncate'
  | 'truncate-latest'
  | 'summarize'
  | 'sliding-window'
  | 'semantic'
  | 'compress'
  | 'error'
  | 'fallback-chain'
  | OverflowStrategyFn;

// ==========================================
// Overflow Config
// ==========================================

/**
 * Configuration for overflow strategies.
 *
 * @example
 * ```typescript
 * overflowConfig: {
 *   summarizer: 'builtin:progressive',
 *   preserveLastN: 10,
 *   summaryBudget: { percent: 30 },
 *   proactiveThreshold: 0.85,
 * }
 * ```
 */
export interface OverflowConfig {
  /** Summarizer implementation (summarize strategy) */
  summarizer?:
    | 'builtin:progressive'
    | 'builtin:map-reduce'
    | SummarizerFn;

  /**
   * Number of recent messages to always preserve verbatim from summarization.
   *
   * When omitted, the summarizer dynamically sizes this to fill ~50% of the
   * slot's token budget (minimum 4). Set explicitly to override the heuristic.
   */
  preserveLastN?: number;

  /**
   * What portion of the slot budget the generated summary content may consume.
   * The summarizer uses this to set target token counts in prompts and
   * `max_tokens` on LLM calls via provider factories.
   *
   * Default: 15% of the slot budget (minimum 64 tokens).
   */
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

  /**
   * BCP 47 language tag for built-in `compress` / lossless phrase packs
   * (e.g. `'en'`, `'de'`). See §8.3 language packs in design doc.
   */
  losslessLocale?: string;

  /**
   * Optional language detector when items omit `ContentItem.losslessLocale`.
   * Use only with in-memory `SlotConfig` (not JSON-serializable). Built-in `compress` forwards this to `LosslessCompressor`.
   */
  losslessDetectLanguage?: (text: string) => string | undefined;

  /**
   * Utilization threshold (0.0-1.0) at which to proactively compress oldest
   * content before the slot is fully over budget.
   *
   * When set, the overflow strategy fires as soon as slot utilization exceeds
   * this value -- even though the slot is technically still within budget.
   * This spreads compression across multiple builds instead of one catastrophic
   * pass when the slot finally overflows.
   *
   * Only applies to compression-like strategies (`summarize`, `compress`, `semantic`).
   *
   * @example
   * ```typescript
   * overflowConfig: {
   *   proactiveThreshold: 0.85, // start compressing at 85% utilization
   *   proactiveRatio: 0.3,      // compress oldest 30% of items
   * }
   * ```
   */
  proactiveThreshold?: number;

  /**
   * Fraction of items to target for compression when `proactiveThreshold` fires (0.0-1.0).
   * The overflow strategy receives a synthetic budget of `usedTokens * (1 - proactiveRatio)`.
   * Default: `0.3` (compress oldest 30%).
   */
  proactiveRatio?: number;

  /**
   * Maximum number of concurrent LLM calls during summarization.
   *
   * When the summarize strategy chunks content into segments, each segment
   * requires an independent LLM call. By default all chunks run in parallel
   * (`Infinity`). Set a finite value to respect provider rate limits.
   *
   * @example
   * ```typescript
   * overflowConfig: {
   *   maxParallelSummarizations: 4,  // at most 4 concurrent LLM calls
   * }
   * ```
   */
  maxParallelSummarizations?: number;
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

  /**
   * Maximum number of content items (independent of token budget).
   * When omitted, the runtime default is 10_000 (see `DEFAULT_SLOT_MAX_ITEMS`, §19.1).
   */
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

  /**
   * Provider with auto-wired LLM capabilities (§10.3).
   *
   * When set, the orchestrator automatically wires summarization and embeddings
   * into the overflow engine. Created via provider factories:
   *
   * ```typescript
   * import { openai } from '@slotmux/providers';
   * slotmuxProvider: openai({ apiKey: process.env.OPENAI_API_KEY })
   * ```
   */
  slotmuxProvider?: SlotmuxProvider;

  /** Plugin instances to activate */
  plugins?: ContextPlugin[];

  /** Event handler for observability */
  onEvent?: (event: ContextEvent) => void;

  /** Enable immutable snapshots (default: true). Disable for performance. */
  immutableSnapshots?: boolean;

  /** Token counting strategy */
  tokenizer?: TokenizerConfig;

  /**
   * When set, used for overflow resolution and snapshot slot totals instead of cached
   * per-item estimates ({@link ContentItem.tokens} / char heuristics).
   */
  tokenAccountant?: TokenAccountant;

  /**
   * When `true`, `Context.build` / `buildStream` require {@link tokenAccountant} so token totals never
   * fall back to cache/char estimates — use for billing-sensitive paths (§19.1).
   */
  requireAuthoritativeTokenCounts?: boolean;

  /**
   * When `true` (and no {@link tokenAccountant}), missing {@link ContentItem.tokens} are filled on first
   * pipeline count using `providerAdapters`’ tokenizer when present, otherwise a char estimate (§18.2).
   */
  lazyContentItemTokens?: boolean;

  /**
   * When `true` (and no accountant / lazy mode), missing `tokens` contribute a char-length estimate to
   * totals without mutating items — for non-critical previews only (§18.2).
   */
  charTokenEstimateForMissing?: boolean;

  /**
   * Structured logger for the build pipeline and overflow strategies (§13.3).
   * Combined with {@link logLevel} via {@link createLeveledLogger}.
   */
  logger?: Logger;

  /**
   * Minimum severity to forward to {@link logger} (default {@link LogLevel.INFO}).
   * When {@link logger} is omitted, level is ignored.
   */
  logLevel?: LogLevel;

  /**
   * PII redaction for {@link onEvent} payloads and {@link logger} output (not stored context).
   * **Default:** redaction is on when omitted (§19.2). Set to `false` to disable.
   * {@link LogLevel.TRACE} disables redaction for full observability (§19.2).
   */
  redaction?: true | false | RedactionOptions;
}
