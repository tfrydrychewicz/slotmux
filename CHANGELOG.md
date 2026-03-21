# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file is managed by [Changesets](https://github.com/changesets/changesets). Package-specific changelogs are generated when publishing.

## 1.0.0-rc.3 — 2026-03-21

### Fixed

#### `slotmux` (core)

- **`forceCompress` on error-strategy slots** — Fixed `ContextOverflowError` thrown when `forceCompress: true` was used with the `chat` preset. The synthetic 50% budget caused the system slot's `overflow: 'error'` strategy to fire even though content was within its real budget. Error-strategy slots are now skipped when `forceCompress` is active and content is within budget.

## 1.0.0-rc.2 — 2026-03-21

### Added

#### `slotmux` (core)

- **`forceCompress` build override** — `ctx.build({ overrides: { forceCompress: true } })` triggers overflow strategies on all eligible slots even when content is within budget. The engine sets a synthetic reduced budget (50% of current usage) so strategies have a meaningful compression target. Works with both `build()` and `buildStream()`. Protected slots are still respected.
- **`slotmuxProvider` config field** — New `ContextConfig.slotmuxProvider` option that auto-wires LLM capabilities (summarization, embeddings) into the build pipeline. When set, compression strategies like `summarize` work out of the box without manual `progressiveSummarize` injection.

#### `@slotmux/providers`

- **Provider factories** — `openai()`, `anthropic()`, `google()`, `mistral()`, `ollama()` factory functions that return a `SlotmuxProvider` bundling the adapter with auto-wired LLM calls. Pass just an API key for the simplest setup; override `compressionModel`, `baseUrl`, or supply custom `summarize`/`embed` functions for advanced use.
- **`SlotmuxProvider` type** — New type that bundles a `ProviderAdapter` with optional `summarizeText`, `mapReduce`, and `embed` capabilities.

#### Documentation

- Forced compression docs across overflow, compression, streaming-build, and getting-started pages.
- `!compress` command in the chatbot tutorial demonstrating on-demand context compression.
- Provider factories documentation in concepts/providers with progressive disclosure API levels.
- First-party plugin documentation pages (RAG, Memory, Tools) with configuration, behavior, and integration patterns.
- SVG diagrams for overflow strategies, budget types, and compression strategies.

## 1.0.0-rc.1 — 2026-03-20

First release candidate. All packages ship at `1.0.0-rc.1`.

### Added

#### `slotmux` (core)

- **Slots & content store** — Named slots with per-slot budgets, priorities, compile positions, and `maxItems` limits. Content items support text, multimodal (image URL/base64), tool calls, pinning, and ephemeral flags.
- **Token budgets** — Fixed, percent, flex, and bounded-flex allocations resolved top-down by priority with response token reservation. Total never exceeds the context window.
- **8 overflow strategies** — `truncate`, `truncate-latest`, `sliding-window`, `summarize` (progressive and map-reduce), `semantic` (embedding similarity), `compress` (lossless phrase packs), `error`, and `fallback-chain`. Custom strategies via async functions.
- **Immutable snapshots** — Every `build()` returns a frozen `ContextSnapshot` with compiled messages, per-slot metadata, timing, warnings, and utilization stats. SHA-256 checksummed serialization/deserialization with schema migration support.
- **Snapshot diffing** — `snapshot.diff(other)` returns added, removed, modified messages and changed slot metadata.
- **Checkpoints** — Lightweight `checkpoint()` / `restore()` for slot state rollback with delta tracking.
- **Streaming build** — `buildStream()` emits `slot:ready` events per compile-order slot with macrotask yields between slots.
- **Reactive context** — `slotmux/reactive` subpath with signals (`ref`, `computedRef`) and `ReactiveContext` for framework-agnostic reactivity.
- **Plugin system** — `ContextPlugin` interface with 11 lifecycle hooks (`install`, `prepareSlots`, `beforeBudgetResolve`, `afterBudgetResolve`, `beforeOverflow`, `afterOverflow`, `beforeSnapshot`, `afterSnapshot`, `onContentAdded`, `onEvent`, `destroy`). Built-in `sanitizePlugin` for prompt injection detection.
- **Event system** — Typed event emitter with 10 event types (`content:added`, `content:evicted`, `content:pinned`, `slot:overflow`, `slot:budget-resolved`, `compression:start`, `compression:complete`, `build:start`, `build:complete`, `warning`).
- **Logging & redaction** — Structured `Logger` with scoped, contextual, and leveled variants. PII redaction engine for events and log output with configurable patterns.
- **Config validation** — Zod schemas for `ContextConfig`, `SlotConfig`, and slot budgets with `safeParseContextConfig` for non-throwing validation.
- **3 presets** — `chat`, `rag`, and `agent` preset slot layouts via `createContext({ preset })`.
- **Model registry** — 60+ built-in models (OpenAI GPT-4/4.1/5/5.4, o-series, Anthropic Claude 3.x/4.x, Google Gemini, Mistral, Ollama) with prefix matching, custom model registration, and provider inference.
- **Token overhead** — Per-provider structural overhead tables (message/conversation/tool overhead tokens).
- **Security defaults** — `DEFAULT_SLOT_MAX_ITEMS` (10,000), near-limit warnings at 80%, `SLOT_ITEMS_WARN_THRESHOLD_RATIO`.
- **Builder pattern** — `contextBuilder()` fluent API as alternative to `createContext`.

#### `@slotmux/providers`

- **5 provider adapters** — `OpenAIAdapter`, `AnthropicAdapter`, `GoogleAdapter`, `MistralAdapter`, `OllamaAdapter` with factory functions (`createOpenAIAdapter`, etc.).
- **Message formatters** — `formatOpenAIMessages`, `formatAnthropicMessages`, `formatGeminiMessages`, `formatMistralMessages`, `formatOllamaMessages` convert compiled messages to each provider's API shape.
- **Role collapsing** — `collapseConsecutiveRoles` (Anthropic), `collapseConsecutiveGeminiRoles` (Google) for providers that reject consecutive same-role messages.

#### `@slotmux/tokenizers`

- **Tokenizer implementations** — `O200kTokenizer` (GPT-4o/4.1/5), `Cl100kTokenizer` (GPT-4/4-turbo), `ClaudeTokenizer`, `SentencePieceTokenizer`, `CharEstimatorTokenizer` (fallback), `FallbackTokenizer`.
- **Token count cache** — `TokenCountCache` with LRU L1 cache and hit/miss metrics.
- **Message counting** — `countCompiledMessages` with per-message and per-conversation overhead.
- **Encoding management** — `freeTiktokenEncodings` for memory cleanup.

#### `@slotmux/compression`

- **Lossless compression** — `LosslessCompressor` with language packs (English, German, minimal). Phrase replacement, whitespace normalization, stop-word removal. Custom language pack registration.
- **Progressive summarization** — `runProgressiveSummarize` with zone partitioning (hot/warm/cold) and layer-based progressive compression.
- **Map-reduce summarization** — `runMapReduceSummarize` with configurable chunk splitting and merge functions.
- **Semantic compression** — `runSemanticCompress` with cosine similarity scoring against anchor content.

#### `@slotmux/debug`

- **Inspector server** — `attachInspector` starts a local HTTP/WebSocket server with real-time slot visualization.
- **Preact UI** — Browser-based inspector at `/inspector/` with timeline, slot breakdown, and event stream.
- **REST endpoints** — `/health`, `/slots`, `/snapshot`, `/events` for programmatic access.

#### `@slotmux/react`

- **React hooks** — `useReactiveContextMeta`, `useReactiveContextUtilization`, `useReactiveContextBuildError` powered by `useSyncExternalStore`.

#### `@slotmux/plugin-rag`

- **RAG plugin** — `ragPlugin` with automatic slot creation, chunk deduplication (`jaccardSimilarity`), citation tracking, and metadata constants.

#### `@slotmux/plugin-tools`

- **Tools plugin** — `toolsPlugin` with tool definition slot management and auto-truncation of tool results (`truncateStringToApproxTokens`).

#### `@slotmux/plugin-otel`

- **OpenTelemetry plugin** — `otelPlugin` emitting spans (`slotmux.build`, `slotmux.overflow`, `slotmux.compress`) and metrics (build duration, tokens used, utilization).

#### `@slotmux/plugin-memory`

- **Memory plugin** — `memoryPlugin` with `InMemoryMemoryStore` and `SQLiteMemoryStore` backends. Fact extraction, ranked retrieval, and Jaccard similarity.

#### Documentation

- VitePress documentation site with getting started guide, chatbot tutorial, 5 concept pages, 16 guides (framework integration, observability, advanced features, production patterns), and API reference.
