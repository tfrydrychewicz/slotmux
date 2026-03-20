# Build a chatbot with context management (~5 minutes)

This walkthrough shows how to **install** contextcraft, **assemble** a multi-turn chat with a system prompt, **build** an immutable snapshot, **shape messages** for the OpenAI Chat Completions API, and **read** snapshot metadata. The runnable core is typechecked in CI; the HTTP call is copy-paste only (needs an API key).

## What you’ll have at the end

- A `Context` pipeline run via the fluent **`contextBuilder()`** API (chat preset).
- **`snapshot.messages`** as internal compiled messages, plus **`formatOpenAIMessages()`** for OpenAI.
- **`snapshot.meta`** for token totals, utilization, and per-slot stats.

## 1. Install and import

```bash
pnpm add contextcraft @contextcraft/providers
```

Add a tokenizer peer for real token counts (OpenAI-style models often use **`o200k_base`**):

```bash
pnpm add gpt-tokenizer
```

Imports used below:

```typescript
import { contextBuilder } from 'contextcraft';
import { formatOpenAIMessages } from '@contextcraft/providers';
```

## 2. Create context with a model

Pick a **model id** (used for registry defaults such as tokenizer and provider hints). Use the **`chat`** preset for a typical system + history layout without hand-writing slot configs:

```typescript
const chain = contextBuilder().model('gpt-4o-mini').preset('chat').reserve(4096);
```

**`reserve(4096)`** holds part of the window for the model’s reply so the budget math matches how you call the API.

## 3. Add a system prompt

```typescript
const withSystem = chain.system('You are a concise helper bot. Reply in one short paragraph.');
```

## 4. Add conversation messages

Chain **`.user()`** / **`.assistant()`** (and **`.push(slot, …)`** when you use custom slots). Each call records another turn in the configured slots.

```typescript
const withHistory = withSystem
  .user('What is contextcraft in one sentence?')
  .assistant(
    'A TypeScript library that manages LLM context windows with slots, token budgets, and overflow strategies.',
  )
  .user('How do I install it?');
```

## 5. Build and send to an LLM API

**`await withHistory.build()`** runs the full pipeline (budget → token count → overflow → compile) and returns **`{ snapshot, context }`**.

The snippet below matches the tutorial source file (no HTTP in CI):

<<< @/snippets/chatbot-tutorial.example.ts

To call **OpenAI Chat Completions**, convert compiled messages and POST them:

```typescript
const { snapshot } = await withHistory.build();
const messages = formatOpenAIMessages(snapshot.messages);

const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env['OPENAI_API_KEY']}`,
  },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    messages,
  }),
});

const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
const reply = data.choices?.[0]?.message?.content;
```

Other providers: use **`@contextcraft/providers`** (`formatAnthropicMessages`, `formatGeminiMessages`, etc.) or map **`snapshot.messages`** yourself.

## 6. Inspect snapshot metadata

After **`build()`**, use **`snapshot.meta`** for observability and UI:

| Field             | Meaning                                         |
| ----------------- | ----------------------------------------------- |
| **`totalTokens`** | Tokens used in the compiled snapshot            |
| **`totalBudget`** | Allocated window budget (after reserve)         |
| **`utilization`** | `totalTokens / totalBudget` (0–1)               |
| **`slots`**       | Per-slot usage, item counts, overflow flags     |
| **`warnings`**    | Near-limit or policy warnings from the pipeline |
| **`buildTimeMs`** | Time spent in the last build                    |

Example:

```typescript
const { snapshot } = await withHistory.build();
const { totalTokens, utilization, slots, warnings } = snapshot.meta;

console.log('tokens', totalTokens, 'utilization', utilization);
console.log('slots', Object.keys(slots));
if (warnings.length > 0) {
  console.warn('context warnings', warnings);
}
```

## Next steps

- **[Getting started](./getting-started)** — minimal install + tiny `createContext` snippet.
- **[API reference](/reference/api/README)** — full exports (generated).
- Deeper **chatbot / RAG / agents** guides are planned under Phase 15.5 (`docs/guides/…`).
