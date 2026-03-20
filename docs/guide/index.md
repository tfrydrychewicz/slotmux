# Guide

Use the guide for tutorials and getting started. For deep dives into the core abstractions, see the [Concepts](/concepts/slots) section. For symbols and types, open the [API reference](/reference/api/README) (generated with TypeDoc at build time).

## Contents

- [Getting started](/guide/getting-started) — install, minimal example, and links to packages.
- [Terminal chatbot tutorial](/guide/build-a-chatbot) — fully working interactive chat with context metadata, token budgets, and OpenAI integration.

## Guides

- [End-to-end chatbot](/guides/chatbot) — multi-turn management, overflow, streaming, checkpoints.
- [RAG application](/guides/rag-application) — document slots, deduplication, semantic overflow, citations.
- [Agent with tools](/guides/agent-with-tools) — tool definitions, results, scratchpad, agent loops.
- [Multi-model & providers](/guides/multi-model) — provider formatters, model registry, switching models.
- [Custom plugin](/guides/custom-plugin) — build a plugin with hooks for the build pipeline.
- [Migration from LangChain](/guides/migration-from-langchain) — mapping LangChain memory patterns to slotmux.

## Framework Integration

- [React](/guides/react) — `@slotmux/react` hooks (`useReactiveContextMeta`, etc.) with `useSyncExternalStore`.
- [Vue](/guides/vue) — `reactiveContext` with `computed` / `watch`, composable patterns, provide/inject.
- [Angular](/guides/angular) — injectable service with Angular Signals, `toSignal`, or `async` pipe.

## Concepts

- [Slots](/concepts/slots) — named context partitions with budgets, priorities, and roles.
- [Budgets](/concepts/budgets) — fixed, percent, flex, and bounded-flex token allocation.
- [Overflow](/concepts/overflow) — eight strategies for when content exceeds its budget.
- [Compression](/concepts/compression) — progressive, semantic, and lossless compression.
- [Snapshots](/concepts/snapshots) — immutable build results with metadata, diffing, and serialization.
