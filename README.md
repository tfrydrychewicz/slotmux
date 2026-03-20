# contextcraft

[![CI](https://github.com/tfrydrychewicz/contextcraft/actions/workflows/ci.yml/badge.svg)](https://github.com/tfrydrychewicz/contextcraft/actions/workflows/ci.yml)
[![Docs](https://github.com/tfrydrychewicz/contextcraft/actions/workflows/docs.yml/badge.svg)](https://github.com/tfrydrychewicz/contextcraft/actions/workflows/docs.yml)
[![npm version](https://img.shields.io/npm/v/contextcraft.svg)](https://www.npmjs.com/package/contextcraft)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![bundle size](<https://img.shields.io/bundlephobia/minzip/contextcraft?label=core%20(minzip)>)](https://bundlephobia.com/package/contextcraft)
[![Coverage](<https://img.shields.io/badge/coverage-vitest%20(local)-6E9F18.svg>)](CONTRIBUTING.md)

> **One-liner:** _The memory allocator for LLM context windows._

**In 30 seconds:** contextcraft is a TypeScript library that manages your AI app’s context window like an OS manages RAM. Declare what matters, set per-slot **budgets** and **priorities**, and let contextcraft handle **token counting**, **overflow**, and **compression**—across OpenAI, Anthropic, Google, and other providers—while keeping a **small core bundle** and full **type safety**.

---

## Features

|                         |                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Slots & budgets**     | Named regions with fixed, percent, or flex token budgets — [concept docs](https://tfrydrychewicz.github.io/contextcraft/reference/) (more in §15.4). |
| **Overflow strategies** | Truncate, sliding window, summarization hooks, custom strategies — [guide](https://tfrydrychewicz.github.io/contextcraft/guide/).                    |
| **Immutable snapshots** | Every `build()` yields a frozen snapshot safe to cache, diff, and serialize.                                                                         |
| **Plugins**             | RAG, tools, memory, OTEL — optional `@contextcraft/*` packages.                                                                                      |
| **Debug inspector**     | Optional UI for timelines and diffs (`@contextcraft/debug`).                                                                                         |
| **React**               | `ReactiveContext` + hooks via [`@contextcraft/react`](https://github.com/tfrydrychewicz/contextcraft/tree/main/packages/react#readme).               |

Full documentation: **[https://tfrydrychewicz.github.io/contextcraft/](https://tfrydrychewicz.github.io/contextcraft/)** (API reference is generated with TypeDoc on deploy).

---

## Requirements

- **Node.js ≥ 20.19** (tooling and optional `@contextcraft/debug` inspector UI).

---

## Install

```bash
pnpm add contextcraft
```

```bash
npm install contextcraft
```

```bash
yarn add contextcraft
```

Install a **tokenizer** for your models (peer-style; pick what you use):

```bash
# OpenAI-style models (e.g. o200k_base)
pnpm add gpt-tokenizer

# Or tiktoken / Anthropic tokenizer for other stacks
pnpm add tiktoken
pnpm add @anthropic-ai/tokenizer
```

---

## Quick start (zero custom slots)

Use the **`chat`** preset and the fluent **`contextBuilder()`** API: model + reserve + messages, then `build()`.

```typescript
import { contextBuilder } from 'contextcraft';

const { snapshot } = await contextBuilder()
  .model('gpt-4o-mini')
  .preset('chat')
  .reserve(4096)
  .system('You are a helpful assistant.')
  .user('How do I manage long conversations in LLM apps?')
  .assistant('Use structured slots, token budgets, and overflow policies.')
  .user('Can you show a minimal code shape?')
  .build();

// Provider-ready compiled messages + metadata (tokens, utilization, per-slot info)
const { messages, meta } = snapshot;
void messages;
void meta;
```

For **validated config** and advanced layout, use **`createContext()`** + **`Context.fromParsedConfig()`** (see [Getting started](https://tfrydrychewicz.github.io/contextcraft/guide/getting-started) on the docs site).

---

## Packages

| Package                       | Description                                                           |
| ----------------------------- | --------------------------------------------------------------------- |
| `contextcraft`                | Core: slots, budgets, build pipeline, snapshots                       |
| `@contextcraft/react`         | Hooks + `ReactiveContext` for UI ([README](packages/react/README.md)) |
| `@contextcraft/tokenizers`    | Token counting adapters                                               |
| `@contextcraft/providers`     | Provider-specific helpers                                             |
| `@contextcraft/compression`   | Progressive, semantic, lossless compression                           |
| `@contextcraft/debug`         | Debug inspector (optional)                                            |
| `@contextcraft/plugin-rag`    | RAG slot defaults, dedupe, citations                                  |
| `@contextcraft/plugin-memory` | Memory stores + `memoryPlugin`                                        |
| `@contextcraft/plugin-tools`  | Tools slot + truncation (`toolsPlugin`)                               |
| `@contextcraft/plugin-otel`   | OpenTelemetry (optional)                                              |

### Debug inspector UI

With `attachInspector(ctx)` running, open **`/inspector/`** on the same host/port (e.g. `http://127.0.0.1:4200/inspector/`). Build the debug package first (`pnpm --filter @contextcraft/debug build`). Browser E2E: `pnpm test:e2e` (install Chromium once: `pnpm --filter @contextcraft/debug exec playwright install chromium`).

---

## Comparison with alternatives

High-level positioning vs common approaches (see **Appendix B** in the design doc for the full product spec).

| Feature                      | contextcraft  | LangChain memory        | tiktoken alone | Manual |
| ---------------------------- | ------------- | ----------------------- | -------------- | ------ |
| Slot-based allocation        | ✅            | ❌                      | ❌             | ❌     |
| Declarative budgets          | ✅            | ❌                      | ❌             | ❌     |
| Multiple overflow strategies | ✅ (7+)       | ✅ (3)                  | ❌             | DIY    |
| Provider agnostic            | ✅            | Partial                 | OpenAI-centric | DIY    |
| Token counting               | ✅ (cached)   | Via tiktoken / wrappers | ✅             | DIY    |
| Plugin system                | ✅            | ❌                      | ❌             | ❌     |
| Immutable snapshots          | ✅            | ❌                      | ❌             | ❌     |
| Debug inspector              | ✅            | ❌                      | ❌             | ❌     |
| Serialization / diffing      | ✅            | ❌                      | ❌             | DIY    |
| Type safety                  | Strong        | Partial                 | Strong         | Varies |
| Standalone                   | ✅            | Needs LangChain         | ✅             | ✅     |
| Core bundle (gzip)           | ~15 kB target | Much larger stack       | ~5 kB          | 0      |

---

## Documentation & links

| Resource         | Link                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------- |
| **Docs site**    | [tfrydrychewicz.github.io/contextcraft](https://tfrydrychewicz.github.io/contextcraft/) |
| **Contributing** | [CONTRIBUTING.md](CONTRIBUTING.md)                                                      |
| **Changelog**    | [CHANGELOG.md](CHANGELOG.md)                                                            |
| **License**      | [MIT](LICENSE)                                                                          |

---

## Contributing

Issues and PRs are welcome. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for setup, tests (`pnpm test:coverage` for coverage locally), changesets, and review expectations.
