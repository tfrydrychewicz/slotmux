/**
 * contextcraft — Intelligent Context Window Manager for AI Applications
 *
 * @packageDocumentation
 */

export const VERSION = '0.0.1';

// Error types (§15.1)
export {
  ContextCraftError,
  BudgetExceededError,
  InvalidBudgetError,
  ContextOverflowError,
  TokenizerNotFoundError,
  CompressionFailedError,
  SnapshotCorruptedError,
  InvalidConfigError,
  SlotNotFoundError,
  ItemNotFoundError,
  MaxItemsExceededError,
} from './errors.js';

// Branded types (§6.6)
export type { TokenCount, SlotPriority, ContentId } from './types/branded.js';
export {
  toTokenCount,
  isTokenCount,
  toSlotPriority,
  isSlotPriority,
  toContentId,
  createContentId,
  isContentId,
} from './types/branded.js';

// Content types (§6.6)
export type {
  MessageRole,
  MultimodalContent,
  MultimodalContentText,
  MultimodalContentImageUrl,
  MultimodalContentImageBase64,
  ContentItem,
  CompiledMessage,
  CompiledContentPart,
  CompiledContentText,
  CompiledContentImageUrl,
  CompiledContentImageBase64,
} from './types/content.js';

// Content store (§20 — Phase 3.1)
export {
  ContentStore,
  createContentItem,
} from './content/content-store.js';
export type { CreateContentItemParams } from './content/content-store.js';

// Slot manager (§20 — Phase 3.2)
export { SlotManager } from './slots/slot-manager.js';
export type { SlotManagerOptions } from './slots/slot-manager.js';

// Budget allocator (§7.1 — Phase 3.3)
export { BudgetAllocator, allocateFlexPool } from './slots/budget-allocator.js';
export type { BudgetAllocatorOptions } from './slots/budget-allocator.js';

// Overflow engine (§7.2 — Phase 4.1)
export {
  OverflowEngine,
  builtinTruncateFifo,
  builtinTruncateLatest,
} from './slots/overflow-engine.js';
export type {
  OverflowEngineInputSlot,
  OverflowEngineOptions,
  OverflowResolveRunOptions,
} from './slots/overflow-engine.js';

// Truncate overflow strategies (§5.2 — Phase 4.2–4.3)
export {
  truncateStrategy,
  truncateFifo,
  sumCachedItemTokens,
  resolveOverflowCountItems,
} from './slots/strategies/truncate-strategy.js';
export {
  truncateLatestStrategy,
  truncateLatest,
} from './slots/strategies/truncate-latest-strategy.js';
export type { TokenAccountant } from './types/token-accountant.js';

// Event types (§6.6, §13.1)
export type {
  ContextEvent,
  ContentAddedEvent,
  ContentEvictedEvent,
  ContentPinnedEvent,
  SlotOverflowEvent,
  SlotBudgetResolvedEvent,
  CompressionStartEvent,
  CompressionCompleteEvent,
  BuildStartEvent,
  BuildCompleteEvent,
  WarningEvent,
} from './types/events.js';

// Snapshot types (§6.6)
export type {
  SlotMeta,
  CompressionEvent,
  EvictionEvent,
  ContextWarning,
  SnapshotMeta,
  SnapshotDiff,
  SerializedSlot,
  SerializedMessage,
  SerializedSnapshot,
  ContextSnapshot,
} from './types/snapshot.js';

// Plugin types (§11.1)
export type {
  ResolvedSlot,
  TokenCountCache,
  CompressionStrategy,
  PluginLogger,
  PluginContext,
  ContextPlugin,
} from './types/plugin.js';

// Provider types (§10.1)
export type {
  Tokenizer,
  ModelCapabilities,
  ProviderAdapter,
} from './types/provider.js';

// Configuration types (§6.6)
export type {
  ProviderId,
  ModelId,
  SlotBudget,
  SlotBudgetFixed,
  SlotBudgetPercent,
  SlotBudgetFlex,
  SlotBudgetBoundedFlex,
  OverflowContext,
  OverflowStrategyFn,
  SummarizerFn,
  SlotOverflowStrategy,
  OverflowConfig,
  SlotConfig,
  ProviderConfig,
  TokenizerConfig,
  ContextConfig,
} from './types/config.js';

// Config validation — Zod (§1.9, §20)
export {
  contextConfigSchema,
  slotConfigSchema,
  slotBudgetSchema,
  slotOverflowNamedSchema,
  slotOverflowStrategySchema,
  overflowConfigSchema,
  validateContextConfig,
  validateSlotConfig,
  safeParseContextConfig,
  safeParseSlotConfig,
} from './config/validator.js';
export type {
  ParsedContextConfig,
  ParsedSlotConfig,
  ParsedSlotBudget,
} from './config/validator.js';

// Presets & createContext (§7.3 — Phase 3.5)
export {
  CHAT_DEFAULTS,
  RAG_DEFAULTS,
  AGENT_DEFAULTS,
  CONTEXT_PRESETS,
} from './config/presets.js';
export type { ContextPresetId } from './config/presets.js';
export {
  createContext,
  resolveContextSlots,
} from './context/create-context.js';
export type {
  CreateContextOptions,
  CreateContextResult,
} from './context/create-context.js';
