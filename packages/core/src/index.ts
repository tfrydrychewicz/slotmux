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
  CompiledToolUse,
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
export {
  BudgetAllocator,
  allocateFlexPool,
  orderedSlotEntriesForBudget,
} from './slots/budget-allocator.js';
export type { BudgetAllocatorOptions } from './slots/budget-allocator.js';

// Overflow engine (§7.2 — Phase 4.1)
export { SlotOverflow } from './slots/slot-overflow.js';
export type { SlotOverflowPreset } from './slots/slot-overflow.js';
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

// Overflow strategies (§5.2 — Phase 4.2–4.6)
export {
  defineCompressionStrategy,
  defineOverflowStrategy,
} from './slots/strategies/define-overflow-strategy.js';
export type {
  OverflowStrategyImplementation,
  OverflowStrategyImplementationArgs,
} from './slots/strategies/define-overflow-strategy.js';
export {
  errorStrategy,
  errorOverflow,
} from './slots/strategies/error-strategy.js';
export {
  slidingWindowStrategy,
  slidingWindow,
  resolveSlidingWindowSize,
  DEFAULT_SLIDING_WINDOW_SIZE,
} from './slots/strategies/sliding-window-strategy.js';
export {
  truncateLatestStrategy,
  truncateLatest,
} from './slots/strategies/truncate-latest-strategy.js';
export {
  truncateStrategy,
  truncateFifo,
  sumCachedItemTokens,
  resolveOverflowCountItems,
} from './slots/strategies/truncate-strategy.js';
export {
  createFallbackChainStrategy,
  FALLBACK_CHAIN_STEPS,
} from './slots/strategies/fallback-chain-strategy.js';
export type {
  FallbackChainStep,
  FallbackChainStrategyDeps,
} from './slots/strategies/fallback-chain-strategy.js';
export type { TokenAccountant } from './types/token-accountant.js';

// Compression (§8 — Phase 8.1)
export type { CompressionContext, CompressionStrategy } from './types/compression.js';
export type { TokenCountCache } from './types/token-count-cache.js';
export {
  compressionContextFromOverflow,
  overflowStrategyLoggerToLogger,
} from './compression/from-overflow-context.js';
export type { CompressionContextFromOverflowDeps } from './compression/from-overflow-context.js';
export {
  LOSSLESS_LANGUAGE_PACK_DE,
  LOSSLESS_LANGUAGE_PACK_EN,
  LOSSLESS_LANGUAGE_PACK_MINIMAL,
  LosslessCompressor,
  createLosslessCompressionStrategy,
  getPlainTextForLossless,
  losslessCompressAsOverflow,
  registerLosslessLanguagePack,
  resolveLosslessLanguagePack,
  unregisterLosslessLanguagePack,
} from './compression/lossless-bridge.js';
export { createProgressiveSummarizeOverflow } from './compression/progressive-overflow-bridge.js';
export type {
  MapReduceSummarizeDeps,
  ProgressiveSummarizeOverflowDeps,
} from './compression/progressive-overflow-bridge.js';
export { semanticCompressAsOverflow } from './compression/semantic-overflow-bridge.js';
export type { EmbedFunction, SemanticScorableItem } from '@contextcraft/compression';
export { cosineSimilarity, runSemanticCompress } from '@contextcraft/compression';
export type {
  LosslessCompressibleItem,
  LosslessCompressorOptions,
  LosslessDetectLanguageFn,
  LosslessLanguagePack,
  LosslessMultimodalBlock,
  LosslessMultimodalImageBase64,
  LosslessMultimodalImageUrl,
  LosslessMultimodalText,
} from './compression/lossless-bridge.js';

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

// Type-safe emitter (§13.1 — Phase 7.1)
export { TypedEventEmitter } from './events/emitter.js';
export type { EventWithTypeField } from './events/emitter.js';

/** {@link TypedEventEmitter} for {@link ContextEvent}. */
export type ContextEventEmitter = import('./events/emitter.js').TypedEventEmitter<
  import('./types/events.js').ContextEvent
>;

// Logging (§13.3 — Phase 7.3)
export { LogLevel } from './logging/logger.js';
export {
  createConsoleLogger,
  createLeveledLogger,
  createPluginLoggerFactory,
  createRedactingLogger,
  createScopedLogger,
} from './logging/logger.js';
export type {
  ConsoleLoggerOptions,
  Logger,
  PluginLoggerFactoryOptions,
  RedactingLoggerOptions,
} from './logging/logger.js';
export {
  DEFAULT_REDACTION_PATTERNS,
  redactString,
  redactUnknown,
} from './logging/redact.js';
export type { RedactionOptions } from './logging/redact.js';

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
} from './types/snapshot.js';
export {
  ContextSnapshot,
} from './snapshot/context-snapshot.js';
export type {
  CreateContextSnapshotParams,
  DeserializeContextSnapshotOptions,
} from './snapshot/context-snapshot.js';
export {
  BUILTIN_SNAPSHOT_MIGRATIONS,
  CURRENT_SNAPSHOT_SCHEMA_VERSION,
  getSnapshotMigrationSteps,
  migrateSnapshotDataToSerializedV1,
  registerSnapshotMigration,
} from './snapshot/snapshot-migrations.js';
export type { SnapshotMigrationStep } from './snapshot/snapshot-migrations.js';
export {
  compiledMessageToPlainText,
  formatCompiledMessagesAsPlainText,
} from './snapshot/format-plain-text.js';

// Plugin types (§11.1)
export type {
  ResolvedSlot,
  PluginLogger,
  PluginContext,
  ContextPlugin,
} from './types/plugin.js';

// Plugin manager (§11.1 — Phase 7.2)
export { PluginManager } from './plugins/plugin-manager.js';
export type { PluginManagerHook, PluginManagerOptions } from './plugins/plugin-manager.js';

// Provider types (§10.1)
export type {
  Tokenizer,
  ModelCapabilities,
  ProviderAdapter,
} from './types/provider.js';
export {
  BaseProviderAdapter,
  structuralOverheadForCompiledMessages,
} from './providers/base-provider-adapter.js';
export {
  defaultMaxOutputTokens,
  defaultModelCapabilities,
  defaultTokenizerNameForProvider,
  modelRegistryEntryToCapabilities,
  resolveModelCapabilitiesForAdapter,
} from './providers/resolve-model-capabilities.js';

// Configuration types (§6.6)
export type {
  ProviderId,
  SnapshotFormatTarget,
  ModelId,
  SlotBudget,
  SlotBudgetFixed,
  SlotBudgetPercent,
  SlotBudgetFlex,
  SlotBudgetBoundedFlex,
  OverflowContext,
  OverflowStrategyFn,
  OverflowStrategyLogger,
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
  clearRegisteredModels,
  inferProviderFromModelId,
  MODEL_REGISTRY,
  normalizeModelId,
  registerModel,
  resolveModel,
} from './config/model-registry.js';
export type { ModelRegistryEntry } from './config/model-registry.js';
export {
  TOKEN_OVERHEAD,
  getTokenOverhead,
  ollamaOverhead,
} from './config/token-overhead.js';
export type {
  ProviderTokenOverhead,
  TokenOverheadProviderId,
} from './config/token-overhead.js';
export {
  assertTokenizerPeersAvailable,
  TOKENIZER_PEER_PACKAGES,
  tryResolveNpmPackage,
} from './config/peer-resolve.js';
export {
  createContext,
  resolveContextSlots,
} from './context/create-context.js';
export type {
  CreateContextOptions,
  CreateContextResult,
} from './context/create-context.js';

// Context runtime (§6.1, §6.3 — Phase 5.1)
export {
  Context,
  DEFAULT_HISTORY_SLOT,
  DEFAULT_SYSTEM_SLOT,
} from './context/context.js';
export type {
  ContextInit,
  ContextPushItemInput,
} from './context/context.js';
export type { ContextCheckpoint } from './context/context-checkpoint.js';
export type {
  ContextBuildOverrides,
  ContextBuildParams,
} from './context/build-overrides.js';
export { mergeParsedConfigForBuild } from './context/build-overrides.js';

// Context builder & orchestrator (§6.5, §5.3 — Phase 5.2)
export {
  ContextBuilder,
  contextBuilder,
} from './context/context-builder.js';
export {
  ContextOrchestrator,
  compileMessagesForSnapshot,
  orderSlotsForCompile,
} from './context/context-orchestrator.js';
export type {
  ContextOrchestratorBuildInput,
  ContextOrchestratorBuildResult,
} from './context/context-orchestrator.js';
