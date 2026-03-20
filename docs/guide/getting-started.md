# Getting started

Get from zero to a working context in under a minute. By the end of this page you'll have slotmux installed, a context built, and messages ready to send to any LLM.

## Install

::: code-group

```bash [pnpm]
pnpm add slotmux
```

```bash [npm]
npm install slotmux
```

```bash [yarn]
yarn add slotmux
```

:::

For accurate token counting, add a tokenizer for your model:

```bash
pnpm add gpt-tokenizer          # OpenAI models (GPT-4o, o1, o3, GPT-5.4)
```

> Without a tokenizer, slotmux falls back to character estimation (~4 chars per token). This is fine for prototyping. Install a real tokenizer before going to production. See [Available tokenizers](/concepts/token-counting#available-tokenizers) for the full list of supported tokenizers and their peer dependencies.

## Your first context

```typescript
import { createContext, Context } from 'slotmux';

// 1. Configure — pick a model, choose a preset
const { config } = createContext({
  model: 'gpt-4o-mini',
  preset: 'chat',           // → system + history slots
  reserveForResponse: 4096, // leave room for the model's reply
});

// 2. Create a context and add content
const ctx = Context.fromParsedConfig(config);
ctx.system('You are a helpful assistant.');
ctx.user('What is slotmux?');

// 3. Build — budgets resolved, overflow handled, snapshot ready
const { snapshot } = await ctx.build();

console.log(snapshot.meta.totalTokens);   // exact token count
console.log(snapshot.meta.utilization);    // 0.0 – 1.0 ratio
console.log(snapshot.meta.buildTimeMs);    // build duration
console.log(snapshot.messages);            // compiled messages
```

That's it. Three steps: **configure**, **add content**, **build**. The snapshot contains everything you need to send to an LLM.

## Send to an LLM

Slotmux compiles to a provider-agnostic format. Use a formatter to convert to your provider's shape:

```typescript
import { formatOpenAIMessages } from '@slotmux/providers';

const messages = formatOpenAIMessages(snapshot.messages);
// → [{ role: 'system', content: '...' }, { role: 'user', content: '...' }]

// Pass to your preferred OpenAI client
const response = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages,
});
```

Formatters are available for every major provider:

```typescript
import {
  formatOpenAIMessages,
  formatAnthropicMessages,
  formatGeminiMessages,
  formatMistralMessages,
  formatOllamaMessages,
} from '@slotmux/providers';
```

Install the providers package:

```bash
pnpm add @slotmux/providers
```

## Choose a preset or define your own

Three presets cover the most common patterns:

```typescript
// Chatbot — system instructions + conversation history
createContext({ model: 'gpt-4o', preset: 'chat' });

// RAG — system + retrieved documents + history + output
createContext({ model: 'gpt-4o', preset: 'rag' });

// Agent — system + tools + scratchpad + history
createContext({ model: 'gpt-4o', preset: 'agent' });
```

Or define a fully custom slot layout:

```typescript
createContext({
  model: 'gpt-4o',
  slots: {
    system:  { priority: 100, budget: { fixed: 2000 },  overflow: 'error',      defaultRole: 'system',    position: 'before' },
    docs:    { priority: 80,  budget: { percent: 30 },   overflow: 'semantic',   defaultRole: 'user',      position: 'before' },
    history: { priority: 50,  budget: { flex: true },    overflow: 'summarize',  defaultRole: 'user',      position: 'after' },
  },
});
```

## Understand what you get back

Every `build()` returns a `ContextSnapshot` with rich metadata:

```typescript
const { snapshot } = await ctx.build();

snapshot.messages          // CompiledMessage[] — ready for formatting
snapshot.meta.totalTokens  // exact token count of compiled messages
snapshot.meta.totalBudget  // total available budget
snapshot.meta.utilization  // 0.0 – 1.0 (totalTokens / totalBudget)
snapshot.meta.buildTimeMs  // how long the build took
snapshot.meta.slots        // per-slot: budgetTokens, usedTokens, evictedCount, utilization
```

Use this metadata to drive UI indicators, alerting, and debugging.

## Packages

| Package | What it does |
| --- | --- |
| `slotmux` | Core — slots, budgets, build pipeline, snapshots, reactive context |
| `@slotmux/providers` | Message formatters for OpenAI, Anthropic, Google, Mistral, Ollama |
| `@slotmux/react` | React hooks for reactive context (`useReactiveContextMeta`, etc.) |
| `@slotmux/compression` | Lossless, progressive, and semantic compression strategies |
| `@slotmux/tokenizers` | Token counting adapters (gpt-tokenizer, tiktoken, Claude) |
| `@slotmux/plugin-rag` | RAG plugin — deduplication, reranking, citation tracking |
| `@slotmux/plugin-tools` | Tool results management with auto-truncation |
| `@slotmux/plugin-memory` | Persistent memory stores across sessions |
| `@slotmux/plugin-otel` | OpenTelemetry traces and metrics |
| `@slotmux/debug` | Browser-based inspector UI for development |

Install only what you need. The core has zero runtime dependencies.

## Framework integration

For real-time UIs that track context utilization as content changes, use `slotmux/reactive`:

- **[React](/guides/react)** — `@slotmux/react` hooks built on `useSyncExternalStore`. Drop-in state management for context metadata.
- **[Vue](/guides/vue)** — Slotmux refs are natively compatible with Vue 3's reactivity system. No extra package needed — just `computed` and `watch`.
- **[Angular](/guides/angular)** — Bridge `reactiveContext` into an injectable service with Angular Signals or the `async` pipe.

## What to read next

<div class="next-steps">

**Build something**

- [Terminal chatbot tutorial](/guide/build-a-chatbot) — A fully working interactive chat with OpenAI in 5 minutes.

**Understand the concepts**

- [Slots](/concepts/slots) — How named partitions structure your context.
- [Budgets](/concepts/budgets) — Fixed, percent, flex, and bounded allocation.
- [Overflow](/concepts/overflow) — What happens when content exceeds its budget.

**Go deeper**

- [Presets & defaults](/guides/presets-and-defaults) — What each preset configures and why.
- [Streaming build](/guides/streaming-build) — Progressive slot delivery for faster time-to-first-token.
- [Error handling](/guides/error-handling) — The full error hierarchy and recovery patterns.
- [Performance tuning](/guides/performance-tuning) — Lazy counting, caching, structural sharing.

</div>
