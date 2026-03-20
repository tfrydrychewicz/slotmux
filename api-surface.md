# Slotmux API Surface Snapshot

> **Generated:** 2026-03-20 — API Freeze Review (§17.2)
>
> Diff this file against future versions to detect breaking changes.
> Symbols are grouped by package and annotated as `value` (class/function/const) or `type`.

---

## `slotmux` (core)

Entry point: `packages/core/src/index.ts`

### Constants

| Symbol | Kind |
|--------|------|
| `VERSION` | value (string) |
| `DEFAULT_CHARS_PER_TOKEN_ESTIMATE` | value |
| `DEFAULT_SLIDING_WINDOW_SIZE` | value |
| `FALLBACK_CHAIN_STEPS` | value |
| `LOSSLESS_LANGUAGE_PACK_DE` | value |
| `LOSSLESS_LANGUAGE_PACK_EN` | value |
| `LOSSLESS_LANGUAGE_PACK_MINIMAL` | value |
| `DEFAULT_REDACTION_PATTERNS` | value |
| `BUILTIN_SNAPSHOT_MIGRATIONS` | value |
| `CURRENT_SNAPSHOT_SCHEMA_VERSION` | value |
| `DEFAULT_SANITIZE_INJECTION_PATTERNS` | value |
| `CHAT_DEFAULTS` | value |
| `RAG_DEFAULTS` | value |
| `AGENT_DEFAULTS` | value |
| `CONTEXT_PRESETS` | value |
| `MODEL_REGISTRY` | value |
| `TOKEN_OVERHEAD` | value |
| `DEFAULT_SLOT_MAX_ITEMS` | value |
| `SLOT_ITEMS_WARN_THRESHOLD_RATIO` | value |
| `DEFAULT_HISTORY_SLOT` | value (string) |
| `DEFAULT_SYSTEM_SLOT` | value (string) |
| `LogLevel` | value (enum) |

### Error Classes

| Symbol | Code | Recoverable |
|--------|------|-------------|
| `SlotmuxError` | `SLOTMUX_ERROR` | false |
| `BudgetExceededError` | `BUDGET_EXCEEDED` | false |
| `InvalidBudgetError` | `INVALID_BUDGET` | false |
| `ContextOverflowError` | `CONTEXT_OVERFLOW` | true |
| `TokenizerNotFoundError` | `TOKENIZER_NOT_FOUND` | false |
| `CompressionFailedError` | `COMPRESSION_FAILED` | true |
| `SnapshotCorruptedError` | `SNAPSHOT_CORRUPTED` | false |
| `InvalidConfigError` | `INVALID_CONFIG` | false |
| `SlotNotFoundError` | `SLOT_NOT_FOUND` | true |
| `ItemNotFoundError` | `ITEM_NOT_FOUND` | true |
| `MaxItemsExceededError` | `MAX_ITEMS_EXCEEDED` | true |

### Classes

| Symbol | Purpose |
|--------|---------|
| `Context` | Mutable runtime context (slots, content, events, build) |
| `ContextBuilder` | Fluent builder for context creation |
| `ContextOrchestrator` | Build pipeline (budget → overflow → compile → snapshot) |
| `ContextSnapshot` | Immutable compiled snapshot (serialize, deserialize, diff, format) |
| `ContextBuildStream` | Streaming build result (slot-by-slot emission) |
| `ContentStore` | Slot-based content storage |
| `SlotManager` | Low-level slot lifecycle management |
| `BudgetAllocator` | Token budget distribution across slots |
| `OverflowEngine` | Overflow strategy execution engine |
| `TypedEventEmitter` | Generic type-safe event emitter |
| `PluginManager` | Plugin lifecycle orchestration |
| `BaseProviderAdapter` | Abstract base for provider adapters |
| `RedactionEngine` | PII redaction for events/logs |
| `LosslessCompressor` | Lossless text compression (phrase packs) |

### Factory Functions

| Symbol | Returns |
|--------|---------|
| `createContext` | `CreateContextResult` |
| `createContentItem` | `ContentItem` |
| `contextBuilder` | `ContextBuilder` |
| `createConsoleLogger` | `Logger` |
| `createContextualLogger` | `Logger` |
| `createLeveledLogger` | `Logger` |
| `createPluginLoggerFactory` | `(name: string) => Logger` |
| `createRedactingLogger` | `Logger` |
| `createScopedLogger` | `Logger` |
| `createContextEventRedactor` | `(event: ContextEvent) => ContextEvent` |
| `createLosslessCompressionStrategy` | `CompressionStrategy` |
| `createProgressiveSummarizeOverflow` | `OverflowStrategyFn` |
| `createFallbackChainStrategy` | `OverflowStrategyFn` |
| `defineCompressionStrategy` | `OverflowStrategyFn` |
| `defineOverflowStrategy` | `OverflowStrategyFn` |

### Utility Functions

| Symbol | Purpose |
|--------|---------|
| `toTokenCount` | Branded constructor |
| `isTokenCount` | Type guard |
| `toSlotPriority` | Branded constructor |
| `isSlotPriority` | Type guard |
| `toContentId` | Branded constructor |
| `createContentId` | Generate unique ContentId |
| `isContentId` | Type guard |
| `compileContentItem` | ContentItem → CompiledMessage |
| `estimateTokenCountFromPlainTextLen` | Char-based token estimation |
| `estimateTokensFromContentPayload` | Content payload token estimation |
| `estimateTokensFromMultimodalContent` | Multimodal token estimation |
| `fillMissingContentItemTokens` | Backfill missing token counts |
| `sumCachedItemTokensWithLazyFill` | Sum with lazy fill |
| `sumCachedOrEstimatedItemTokens` | Sum with char estimate fallback |
| `tryResolveTokenizerForLazyFill` | Resolve tokenizer for lazy counting |
| `allocateFlexPool` | Flex budget allocation |
| `orderedSlotEntriesForBudget` | Sort slots for budget pass |
| `builtinTruncateFifo` | FIFO truncation (engine-level) |
| `builtinTruncateLatest` | Latest truncation (engine-level) |
| `errorStrategy` | Error overflow implementation |
| `errorOverflow` | Error overflow (alias) |
| `slidingWindowStrategy` | Sliding window implementation |
| `slidingWindow` | Sliding window (alias) |
| `resolveSlidingWindowSize` | Resolve window size from config |
| `truncateLatestStrategy` | Truncate-latest implementation |
| `truncateLatest` | Truncate-latest (alias) |
| `truncateStrategy` | FIFO truncation implementation |
| `truncateFifo` | FIFO truncation (alias) |
| `sumCachedItemTokens` | Sum cached item tokens |
| `resolveOverflowCountItems` | Resolve countable items for overflow |
| `compressionContextFromOverflow` | Bridge overflow → compression context |
| `overflowStrategyLoggerToLogger` | Bridge strategy logger → Logger |
| `overflowStrategyLoggerFromLogger` | Bridge Logger → strategy logger |
| `getPlainTextForLossless` | Extract text for lossless compression |
| `losslessCompressAsOverflow` | Lossless compression as overflow strategy |
| `registerLosslessLanguagePack` | Register custom language pack |
| `resolveLosslessLanguagePack` | Resolve language pack by locale |
| `unregisterLosslessLanguagePack` | Unregister language pack |
| `semanticCompressAsOverflow` | Semantic compression as overflow strategy |
| `cosineSimilarity` | Cosine similarity (from @slotmux/compression) |
| `runSemanticCompress` | Semantic compress (from @slotmux/compression) |
| `noopLogger` | No-op logger instance |
| `newBuildOperationId` | Generate build operation ID |
| `redactString` | Redact PII from string |
| `redactUnknown` | Redact PII from unknown value |
| `redactContextEvent` | Redact PII from context event |
| `shouldRedactObservability` | Check if redaction is needed |
| `compiledMessageToPlainText` | CompiledMessage → plain text |
| `formatCompiledMessagesAsPlainText` | Messages → plain text |
| `getSnapshotMigrationSteps` | Get migration steps for version range |
| `migrateSnapshotDataToSerializedV1` | Migrate snapshot to v1 |
| `registerSnapshotMigration` | Register custom migration step |
| `sanitizePlugin` | Built-in prompt injection sanitizer plugin |
| `structuralOverheadForCompiledMessages` | Message structural overhead |
| `defaultMaxOutputTokens` | Default max output tokens |
| `defaultModelCapabilities` | Default model capabilities |
| `defaultTokenizerNameForProvider` | Default tokenizer for provider |
| `modelRegistryEntryToCapabilities` | Registry entry → capabilities |
| `resolveModelCapabilitiesForAdapter` | Resolve capabilities for adapter |
| `validateContextConfig` | Zod validation |
| `validateSlotConfig` | Zod slot validation |
| `safeParseContextConfig` | Safe Zod parse (no throw) |
| `safeParseSlotConfig` | Safe Zod slot parse |
| `clearRegisteredModels` | Clear custom model registrations |
| `inferProviderFromModelId` | Infer provider from model ID |
| `normalizeModelId` | Normalize model ID string |
| `registerModel` | Register custom model |
| `resolveModel` | Resolve model from registry |
| `getTokenOverhead` | Token overhead for provider |
| `ollamaOverhead` | Ollama-specific overhead |
| `effectiveSlotMaxItems` | Effective max items for slot |
| `slotItemsNearLimitThreshold` | Near-limit warning threshold |
| `assertTokenizerPeersAvailable` | Check tokenizer peer packages |
| `resolveContextSlots` | Resolve slots from preset/overrides |
| `mergeParsedConfigForBuild` | Merge config for build overrides |
| `compileMessagesForSnapshot` | Compile messages for snapshot |
| `compileSlotMessages` | Compile slot to messages |
| `orderSlotsForCompile` | Order slots for compilation |
| `defaultStreamYield` | Default yield between stream slots |

### Zod Schemas (value)

| Symbol |
|--------|
| `contextConfigSchema` |
| `slotConfigSchema` |
| `slotBudgetSchema` |
| `slotOverflowNamedSchema` |
| `slotOverflowStrategySchema` |
| `overflowConfigSchema` |

### Types

| Symbol | Kind |
|--------|------|
| `TokenCount` | branded type |
| `SlotPriority` | branded type |
| `ContentId` | branded type |
| `MessageRole` | union type |
| `MultimodalContent` | union type |
| `MultimodalContentText` | interface |
| `MultimodalContentImageUrl` | interface |
| `MultimodalContentImageBase64` | interface |
| `ContentItem` | interface |
| `CompiledMessage` | interface |
| `CompiledContentPart` | union type |
| `CompiledContentText` | interface |
| `CompiledContentImageUrl` | interface |
| `CompiledContentImageBase64` | interface |
| `CompiledToolUse` | interface |
| `ContentStoreOptions` | interface |
| `CreateContentItemParams` | interface |
| `SlotManagerOptions` | interface |
| `BudgetAllocatorOptions` | interface |
| `SlotOverflowPreset` | type |
| `OverflowEngineInputSlot` | interface |
| `OverflowEngineOptions` | interface |
| `OverflowResolveRunOptions` | interface |
| `OverflowStrategyImplementation` | interface |
| `OverflowStrategyImplementationArgs` | interface |
| `FallbackChainStep` | interface |
| `FallbackChainStrategyDeps` | interface |
| `TokenAccountant` | interface |
| `CompressionContext` | interface |
| `CompressionStrategy` | interface |
| `TokenCountCache` | interface |
| `CompressionContextFromOverflowDeps` | interface |
| `MapReduceSummarizeDeps` | interface |
| `ProgressiveSummarizeOverflowDeps` | interface |
| `EmbedFunction` | type (from @slotmux/compression) |
| `SemanticScorableItem` | interface (from @slotmux/compression) |
| `LosslessCompressibleItem` | interface |
| `LosslessCompressorOptions` | interface |
| `LosslessDetectLanguageFn` | type |
| `LosslessLanguagePack` | interface |
| `LosslessMultimodalBlock` | union type |
| `LosslessMultimodalImageBase64` | interface |
| `LosslessMultimodalImageUrl` | interface |
| `LosslessMultimodalText` | interface |
| `ContextEvent` | union type |
| `ContentAddedEvent` | interface |
| `ContentEvictedEvent` | interface |
| `ContentPinnedEvent` | interface |
| `SlotOverflowEvent` | interface |
| `SlotBudgetResolvedEvent` | interface |
| `CompressionStartEvent` | interface |
| `CompressionCompleteEvent` | interface |
| `BuildStartEvent` | interface |
| `BuildCompleteEvent` | interface |
| `WarningEvent` | interface |
| `EventWithTypeField` | interface |
| `ContextEventEmitter` | type alias |
| `ConsoleLoggerOptions` | interface |
| `LogContextFields` | interface |
| `Logger` | interface |
| `PluginLoggerFactoryOptions` | interface |
| `RedactingLoggerOptions` | interface |
| `RedactionOptions` | interface |
| `ObservabilityRedactionConfig` | interface |
| `SlotMeta` | interface |
| `CompressionEvent` | interface |
| `EvictionEvent` | interface |
| `ContextWarning` | interface |
| `SnapshotMeta` | interface |
| `SnapshotDiff` | interface |
| `SnapshotSlotMetaDiff` | interface |
| `SerializedSlot` | type alias |
| `SerializedMessage` | type alias |
| `SerializedSnapshot` | interface |
| `CreateContextSnapshotParams` | interface |
| `DeserializeContextSnapshotOptions` | interface |
| `SnapshotMigrationStep` | interface |
| `ResolvedSlot` | interface |
| `PluginLogger` | type alias |
| `PluginContext` | interface |
| `PluginOverflowContext` | type |
| `PluginOverflowEnv` | type |
| `ContextPlugin` | interface |
| `PluginManagerHook` | type |
| `PluginManagerOptions` | interface |
| `SanitizePluginOptions` | interface |
| `Tokenizer` | interface |
| `ModelCapabilities` | interface |
| `ProviderAdapter` | interface |
| `ProviderId` | union type |
| `SnapshotFormatTarget` | type |
| `ModelId` | type alias |
| `SlotBudget` | union type |
| `SlotBudgetFixed` | interface |
| `SlotBudgetPercent` | interface |
| `SlotBudgetFlex` | interface |
| `SlotBudgetBoundedFlex` | interface |
| `OverflowContext` | interface |
| `OverflowStrategyFn` | type |
| `OverflowStrategyLogger` | interface |
| `SummarizerFn` | type |
| `SlotOverflowStrategy` | union type |
| `OverflowConfig` | interface |
| `SlotConfig` | interface |
| `ProviderConfig` | interface |
| `TokenizerConfig` | interface |
| `ContextConfig` | interface |
| `ParsedContextConfig` | type |
| `ParsedSlotConfig` | type |
| `ParsedSlotBudget` | type |
| `ContextPresetId` | type |
| `ModelRegistryEntry` | interface |
| `ProviderTokenOverhead` | interface |
| `TokenOverheadProviderId` | type |
| `CreateContextOptions` | type |
| `CreateContextResult` | interface |
| `ContextInit` | type |
| `ContextPushItemInput` | type |
| `BuildStreamEvent` | type |
| `ContextCheckpoint` | interface |
| `ContextBuildOverrides` | interface |
| `ContextBuildParams` | interface |
| `ContextOrchestratorBuildInput` | interface |
| `ContextOrchestratorBuildResult` | interface |

---

## `slotmux/reactive` (subpath)

Entry point: `packages/core/src/reactive.ts`

| Symbol | Kind |
|--------|------|
| `reactiveContext` | value (factory function) |
| `ReactiveContext` | value (class) |
| `ReactiveContextInit` | type |
| `ref` | value (function) |
| `computedRef` | value (function) |
| `Ref` | type |
| `ReadonlyRef` | type |
| `RefUnsubscribe` | type |

---

## `@slotmux/providers`

Entry point: `packages/providers/src/index.ts`

| Symbol | Kind |
|--------|------|
| `VERSION` | value (string) |
| `createAnthropicAdapter` | value (factory) |
| `AnthropicAdapter` | value (class) |
| `collapseConsecutiveRoles` | value (function) |
| `formatAnthropicMessages` | value (function) |
| `AnthropicContentBlock` | type |
| `AnthropicImageBlock` | type |
| `AnthropicMessageParam` | type |
| `AnthropicMessagesPayload` | type |
| `AnthropicTextBlock` | type |
| `AnthropicToolResultBlock` | type |
| `AnthropicToolUseBlock` | type |
| `collapseConsecutiveGeminiRoles` | value (function) |
| `createGoogleAdapter` | value (factory) |
| `formatGeminiMessages` | value (function) |
| `GoogleAdapter` | value (class) |
| `GeminiContent` | type |
| `GeminiGenerateContentPayload` | type |
| `GeminiPart` | type |
| `createMistralAdapter` | value (factory) |
| `formatMistralMessages` | value (function) |
| `MistralAdapter` | value (class) |
| `MistralChatMessage` | type |
| `createOllamaAdapter` | value (factory) |
| `formatOllamaMessages` | value (function) |
| `OllamaAdapter` | value (class) |
| `OllamaChatMessage` | type |
| `OllamaToolCall` | type |
| `createOpenAIAdapter` | value (factory) |
| `formatOpenAIMessages` | value (function) |
| `OpenAIAdapter` | value (class) |
| `orderSystemMessagesFirst` | value (function) |
| `OpenAIChatCompletionMessage` | type |
| `OpenAIChatContentPart` | type |

---

## `@slotmux/tokenizers`

Entry point: `packages/tokenizers/src/index.ts`

| Symbol | Kind |
|--------|------|
| `VERSION` | value (string) |
| `Tokenizer` | type (re-export from slotmux) |
| `compiledMessageToEstimationString` | value (function) |
| `CHARS_PER_TOKEN_ESTIMATE` | value (number) |
| `CharEstimatorTokenizer` | value (class) |
| `PER_CONVERSATION_OVERHEAD_TOKENS` | value (number) |
| `PER_MESSAGE_OVERHEAD_TOKENS` | value (number) |
| `compiledMessageTokenUnits` | value (function) |
| `countCompiledMessages` | value (function) |
| `Cl100kTokenizer` | value (class) |
| `O200kTokenizer` | value (class) |
| `freeTiktokenEncodings` | value (function) |
| `ClaudeTokenizer` | value (class) |
| `SentencePieceTokenizer` | value (class) |
| `GptTokenizerEncodingName` | type |
| `FallbackTokenizer` | value (class) |
| `TokenCountCache` | value (class) |
| `TokenCountCacheMetrics` | type |
| `TokenCountCacheOptions` | type |

---

## `@slotmux/compression`

Entry point: `packages/compression/src/index.ts`

| Symbol | Kind |
|--------|------|
| `VERSION` | value (string) |
| `LOSSLESS_LANGUAGE_PACK_DE` | value |
| `LOSSLESS_LANGUAGE_PACK_EN` | value |
| `LOSSLESS_LANGUAGE_PACK_MINIMAL` | value |
| `LosslessCompressor` | value (class) |
| `getPlainTextForLossless` | value (function) |
| `registerLosslessLanguagePack` | value (function) |
| `resolveLosslessLanguagePack` | value (function) |
| `unregisterLosslessLanguagePack` | value (function) |
| `LosslessCompressibleItem` | type |
| `LosslessCompressorOptions` | type |
| `LosslessDetectLanguageFn` | type |
| `LosslessLanguagePack` | type |
| `LosslessMultimodalBlock` | type |
| `LosslessMultimodalImageBase64` | type |
| `LosslessMultimodalImageUrl` | type |
| `LosslessMultimodalText` | type |
| `DEFAULT_PROGRESSIVE_PROMPTS` | value |
| `partitionProgressiveZones` | value (function) |
| `ProgressiveZones` | type |
| `runProgressiveSummarize` | value (function) |
| `RunProgressiveSummarizeOptions` | type |
| `ProgressiveItem` | type |
| `ProgressiveLayer` | type |
| `ProgressivePrompts` | type |
| `ProgressiveSummarizeTextFn` | type |
| `DEFAULT_MAP_REDUCE_PROMPTS` | value |
| `chunkBulkForMap` | value (function) |
| `runMapReduceSummarize` | value (function) |
| `splitTextToTokenBudget` | value (function) |
| `RunMapReduceSummarizeOptions` | type |
| `MapReduceMapChunkFn` | type |
| `MapReducePrompts` | type |
| `MapReduceReduceMergeFn` | type |
| `MapReduceSummarizeDeps` | type |
| `cosineSimilarity` | value (function) |
| `runSemanticCompress` | value (function) |
| `RunSemanticCompressParams` | type |
| `EmbedFunction` | type |
| `SemanticScorableItem` | type |

---

## `@slotmux/debug`

Entry point: `packages/debug/src/index.ts`

| Symbol | Kind |
|--------|------|
| `VERSION` | value (string) |
| `InspectorDisabledError` | value (class) |
| `attachInspector` | value (function) |
| `DEFAULT_MAX_EVENTS` | value (number) |
| `DEFAULT_PORT` | value (number) |
| `AttachInspectorOptions` | type |
| `InspectorHandle` | type |
| `serializeContextEventForJson` | value (function) |

---

## `@slotmux/react`

Entry point: `packages/react/src/index.ts`

| Symbol | Kind |
|--------|------|
| `VERSION` | value (string) |
| `useReactiveContextMeta` | value (hook) |
| `useReactiveContextUtilization` | value (hook) |
| `useReactiveContextBuildError` | value (hook) |

---

## `@slotmux/plugin-rag`

Entry point: `packages/plugin-rag/src/index.ts`

| Symbol | Kind |
|--------|------|
| `VERSION` | value (string) |
| `dedupeNearDuplicateChunks` | value (function) |
| `jaccardSimilarity` | value (function) |
| `ragItemPlainText` | value (function) |
| `RAG_METADATA_CHUNK_ID` | value (string) |
| `RAG_METADATA_SCORE` | value (string) |
| `ragPlugin` | value (function) |
| `RagCitation` | type |
| `RagPlugin` | type |
| `RagPluginOptions` | type |

---

## `@slotmux/plugin-tools`

Entry point: `packages/plugin-tools/src/index.ts`

| Symbol | Kind |
|--------|------|
| `VERSION` | value (string) |
| `estimateTokensFromText` | value (function) |
| `truncateStringToApproxTokens` | value (function) |
| `TOOLS_KIND_DEFINITION` | value (string) |
| `TOOLS_METADATA_KIND` | value (string) |
| `toolsPlugin` | value (function) |
| `ToolsPluginOptions` | type |

---

## `@slotmux/plugin-otel`

Entry point: `packages/plugin-otel/src/index.ts`

| Symbol | Kind |
|--------|------|
| `VERSION` | value (string) |
| `OTEL_METRIC_BUILD_DURATION` | value (string) |
| `OTEL_METRIC_TOKENS_USED` | value (string) |
| `OTEL_METRIC_UTILIZATION` | value (string) |
| `OTEL_SPAN_BUILD` | value (string) |
| `OTEL_SPAN_COMPRESS` | value (string) |
| `OTEL_SPAN_OVERFLOW` | value (string) |
| `otelPlugin` | value (function) |
| `OtelPluginOptions` | type |

---

## `@slotmux/plugin-memory`

Entry point: `packages/plugin-memory/src/index.ts`

| Symbol | Kind |
|--------|------|
| `VERSION` | value (string) |
| `extractFactCandidatesFromMessages` | value (function) |
| `InMemoryMemoryStore` | value (class) |
| `memoryPlugin` | value (function) |
| `MemoryPluginOptions` | type |
| `MemoryRecord` | type |
| `MemorySetInput` | type |
| `MemoryStore` | type |
| `jaccardSimilarity` | value (function) |
| `rankMemories` | value (function) |
| `MemoryRetrievalStrategy` | type |
| `RankedMemory` | type |
| `isBetterSqliteAvailable` | value (function) |
| `SQLiteMemoryStore` | value (class) |

---

## Cross-Package Re-exports

| Consumer | Source | Symbols |
|----------|--------|---------|
| `slotmux` | `@slotmux/compression` | `cosineSimilarity`, `runSemanticCompress`, `EmbedFunction` (type), `SemanticScorableItem` (type) |

---

## Changes from Pre-Freeze Audit

Removed from public surface (internal implementation details):

- `slotmux`: `computeBuildReuseFingerprint`, `BuildReuseFingerprintSource` (type), `wrapContentItemLazyTokens`, `tryResolveNpmPackage`, `TOKENIZER_PEER_PACKAGES`
- `@slotmux/tokenizers`: `LRUCache`, re-exports of `TOKEN_OVERHEAD`/`getTokenOverhead`/`ollamaOverhead`/`ProviderTokenOverhead`/`TokenOverheadProviderId` (canonical source: `slotmux`)

Added:

- `@slotmux/react`: `VERSION` (consistency with all other packages)
