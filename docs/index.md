---
layout: home

hero:
  name: Slotmux
  text: Your LLM app has a token budget. Slotmux manages it.
  image:
    src: /slotmux.svg
    alt: Slotmux logo
  tagline: "Organize your context into slots with budgets. Pin what matters. Overflow intelligently. Build once, send to any provider."
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Build a chatbot in 5 min
      link: /guide/build-a-chatbot
    - theme: alt
      text: View on GitHub
      link: https://github.com/tfrydrychewicz/slotmux

features:
  - icon: 🧱
    title: Slots, not strings
    details: "Every piece of context gets a named slot — system prompt, chat history, documents, tools. Each slot has its own token budget and overflow strategy. No more guessing if your prompt fits."
  - icon: 🎯
    title: Budgets that actually work
    details: "Fixed tokens, percentages, flex, or bounded ranges. Slotmux resolves budgets by priority, reserves space for the response, and guarantees you never exceed the context window."
  - icon: 🔄
    title: Smart overflow, per slot
    details: "RAG docs overflowing? Summarize them. Chat history too long? Slide the window. Tool results piling up? Keep the most relevant. Eight strategies built in, or bring your own."
  - icon: 📌
    title: Pin what matters
    details: "Mark a document or instruction as pinned. Slotmux will never compress or drop it, no matter how tight the budget gets. Critical context stays critical."
  - icon: 🔌
    title: Build once, send anywhere
    details: "Compile your context once. Format it for OpenAI, Anthropic, Google, Mistral, or Ollama. Same logic, same budgets — just swap the provider. Model-agnostic by design."
  - icon: ⚡
    title: 7 kB. Zero lock-in.
    details: "Tree-shakeable ESM core. Sub-millisecond token counting. Works with React, Vue, Angular, or plain Node.js. TypeScript-first with Zod-backed config validation."
---

<style>
.section-block {
  max-width: 960px;
  margin: 3rem auto 0;
  padding: 0 24px;
}
.section-block h2 {
  font-size: 1.6rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}
.section-block h3 {
  font-size: 1.15rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
}
.section-block p {
  color: var(--vp-c-text-2);
  font-size: 1.05rem;
  line-height: 1.7;
  margin-bottom: 1.25rem;
}
.diagram-row {
  display: flex;
  gap: 2rem;
  align-items: flex-start;
  margin: 2rem 0;
}
.diagram-row img {
  border-radius: 8px;
}
@media (max-width: 768px) {
  .diagram-row {
    flex-direction: column;
  }
}
.cta-section {
  text-align: center;
  padding: 3rem 24px 4rem;
}
.cta-section h2 {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}
.cta-section p {
  color: var(--vp-c-text-2);
  font-size: 1.05rem;
  margin-bottom: 1.5rem;
}
</style>

<div class="section-block">

## The problem you already have

If you're building an app that talks to an LLM, you're managing a context window — whether you know it or not. System prompts, chat history, RAG documents, tool results: they all share one token budget.

Most teams handle this by concatenating strings, counting tokens manually, and truncating from the top when things don't fit. A critical instruction disappears. A document gets silently dropped. The model hallucinates because it lost something it needed.

<p align="center">
  <img src="/context-window-problem.svg" alt="Context window overflowing without slotmux" style="max-width: 520px; width: 100%;" />
</p>

</div>

<div class="section-block">

## Slots: a better mental model

Instead of one big blob of text, slotmux lets you organize context into **named slots** — each with its own token budget, priority, and overflow strategy. Think of it like a memory allocator, but for your prompt.

The system prompt gets a fixed budget. RAG documents get 40% of the remaining space. Chat history fills whatever is left. And there's always room reserved for the model's response.

If a user said something important, or a document is critical — **pin it**. Slotmux will never compress or drop pinned content, no matter how tight the budget gets.

<p align="center">
  <img src="/context-window-slots.svg" alt="Context window organized into slots with budgets" style="max-width: 520px; width: 100%;" />
</p>

</div>

<div class="section-block">

## What happens when a slot overflows?

This is where slotmux gets interesting. Instead of one global "truncate from the top" strategy, you choose what happens when **each individual slot** runs out of space.

Your RAG documents overflow? **Summarize** them progressively — the meaning is preserved. Chat history grows too long? Use a **sliding window** to keep recent messages. Tool results piling up? Keep only the most **semantically relevant** ones based on embedding similarity.

<p align="center">
  <img src="/overflow-strategies.svg" alt="Three overflow strategies side by side" style="max-width: 720px; width: 100%;" />
</p>

Eight strategies built in: `truncate`, `truncate-latest`, `sliding-window`, `summarize`, `semantic`, `compress`, `error`, and `fallback-chain`. Or write your own with a simple async function.

</div>

<div class="section-block">

### The simplest case

```typescript
import { createContext, Context } from 'slotmux';
import { openai, formatOpenAIMessages } from '@slotmux/providers';

const { config } = createContext({
  model: 'gpt-5.4',
  preset: 'chat',
  reserveForResponse: 4096,
  slotmuxProvider: openai({ apiKey: process.env.OPENAI_API_KEY! }),
});

const ctx = Context.fromParsedConfig(config);
ctx.system('You are a helpful assistant.');
ctx.user('What is the capital of France?');

const { snapshot } = await ctx.build();
const messages = formatOpenAIMessages(snapshot.messages);
// Overflow summarization is auto-wired through the provider.
```

### A real-world RAG agent

```typescript
createContext({
  model: 'claude-sonnet-4-20250514',
  reserveForResponse: 8192,
  slots: {
    system:  { priority: 100, budget: { fixed: 2000 },  overflow: 'error' },
    docs:    { priority: 80,  budget: { percent: 40 },  overflow: 'summarize' },
    tools:   { priority: 70,  budget: { flex: true },   overflow: 'semantic' },
    history: { priority: 50,  budget: { flex: true },   overflow: 'sliding-window' },
  },
  plugins: [ragPlugin({ maxChunks: 20 }), sanitizePlugin()],
});
```

</div>

<div class="section-block">

## Build once, send to any provider

Slotmux compiles your context into its own format. Then you format it for whatever provider you're using — or multiple providers at once:

```typescript
import { formatOpenAIMessages, formatAnthropicMessages } from '@slotmux/providers';

const { snapshot } = await ctx.build();

const forGPT    = formatOpenAIMessages(snapshot.messages);
const forClaude = formatAnthropicMessages(snapshot.messages);
```

Same slot definitions, same overflow strategies, same token budgets — whether you're talking to GPT, Claude, Gemini, Mistral, or a local model through Ollama.

</div>

<div class="section-block">

## Works with your stack

| Framework | Integration |
| --- | --- |
| **React** | [`@slotmux/react`](/guides/react) hooks with `useSyncExternalStore` |
| **Vue** | [Native ref compatibility](/guides/vue) — `computed`, `watch`, composables |
| **Angular** | [Injectable services](/guides/angular) with Signals and `async` pipe |
| **Node.js** | Direct API — no framework needed |
| **Any provider** | OpenAI, Anthropic, Google, Mistral, Ollama — [one snapshot, any format](/concepts/providers) |

</div>

<div class="section-block">

## Built for production

Slotmux is not a prototype tool. It ships with SHA-256 snapshot checksums, PII redaction on events and logs, prompt injection sanitization, per-slot resource limits, and an error hierarchy with `recoverable` flags for graceful degradation.

Performance is enforced in CI: single-digit-millisecond builds for typical workloads, sub-millisecond cached token counting, and structural sharing across snapshots to minimize GC pressure. All in **7 kB gzipped**.

</div>

<div class="cta-section">

## Ready to stop worrying about context windows?

Install slotmux and build your first context in under a minute.

[Get started](/guide/getting-started) | [Tutorial: Build a chatbot](/guide/build-a-chatbot) | [API reference](/reference/api/README)

</div>
