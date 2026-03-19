/**
 * contextcraft — Intelligent Context Window Manager for AI Applications
 *
 * @packageDocumentation
 */

export const VERSION = '0.0.1';

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
