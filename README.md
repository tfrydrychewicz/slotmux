# contextcraft

> The memory allocator for LLM context windows.

[![CI](https://github.com/tfrydrychewicz/contextcraft/actions/workflows/ci.yml/badge.svg)](https://github.com/tfrydrychewicz/contextcraft/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/contextcraft.svg)](https://www.npmjs.com/package/contextcraft)

contextcraft is a TypeScript library that manages your AI app's context window like an OS manages RAM. Declare what matters, set priorities, and let contextcraft handle token counting, overflow, and compression — across any LLM provider.

## Requirements

- **Node.js** ≥ **20.19** (required for this repo’s toolchain, including Vite 8 for `@contextcraft/debug`’s inspector UI build)

## Install

```bash
pnpm add contextcraft
# or
npm install contextcraft
```

Install a tokenizer for your model (peer dependency):

```bash
# For OpenAI models
pnpm add tiktoken

# For Claude models
pnpm add @anthropic-ai/tokenizer

# Lightweight alternative
pnpm add gpt-tokenizer
```

## Quick Start

```typescript
import { createContext } from 'contextcraft';

const ctx = createContext({
  model: 'gpt-4-turbo',
  reserveForResponse: 4096,
});

ctx.system('You are a helpful assistant.');
ctx.user('How do I use generics with conditional types?');
ctx.assistant('Conditional types in TypeScript allow you to...');
ctx.user('Can you show me a more complex example?');

const { messages, meta } = ctx.build();
// messages: ready for OpenAI/Anthropic API
// meta: { totalTokens, utilization, slots: {...} }
```

## Packages

| Package | Description |
|---------|-------------|
| `contextcraft` | Core library |
| `@contextcraft/tokenizers` | Token counting abstractions |
| `@contextcraft/providers` | LLM provider adapters |
| `@contextcraft/compression` | Compression strategies |
| `@contextcraft/debug` | Debug inspector (optional) |
| `@contextcraft/plugin-rag` | RAG slot defaults, dedupe, maxChunks, optional rerank & citations (`ragPlugin`) |
| `@contextcraft/plugin-memory` | `MemoryStore`, `SQLiteMemoryStore`, hybrid retrieval, `memoryPlugin` (Node; uses `better-sqlite3`) |
| `@contextcraft/plugin-tools` | Tool/function calls |
| `@contextcraft/plugin-otel` | OpenTelemetry spans & metrics (optional) |

### Debug inspector UI

With `attachInspector(ctx)` running, open **`/inspector/`** on the same host/port (e.g. `http://127.0.0.1:4200/inspector/`). Build the debug package first (`pnpm --filter @contextcraft/debug build`) so static assets exist. Browser E2E: `pnpm test:e2e` (install Chromium once: `pnpm --filter @contextcraft/debug exec playwright install chromium`).

## Links

- [Documentation](https://github.com/tfrydrychewicz/contextcraft#readme) (coming soon)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

## License

MIT
