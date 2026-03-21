# End-to-end chatbot

This guide goes deeper than the [terminal chatbot tutorial](/guide/build-a-chatbot). It covers multi-turn management, overflow behavior, streaming builds, checkpoints, and production patterns.

## Context structure

The `chat` preset creates two slots:

| Slot | Priority | Budget | Overflow | Role |
| --- | --- | --- | --- | --- |
| `system` | 100 | fixed 2 000 | `error` | `system` |
| `history` | 50 | flex | `summarize` | `user` |

The system slot is protected — it throws if the system prompt exceeds 2 000 tokens. The history slot takes the remaining budget and summarizes older messages when it overflows.

```typescript
import { createContext, Context } from 'slotmux';

const { config } = createContext({
  model: 'gpt-5.4-mini',
  preset: 'chat',
  reserveForResponse: 4096,
  lazyContentItemTokens: true,
});

const ctx = Context.fromParsedConfig(config);
ctx.system('You are a helpful coding assistant. Be concise.');
```

## Multi-turn conversation

Push user and assistant messages turn by turn. Slotmux tracks them in the history slot in insertion order.

```typescript
ctx.user('How do I read a file in Node.js?');
const { snapshot: snap1 } = await ctx.build();
// → send snapshot to LLM, get response

ctx.assistant('Use fs.readFileSync() for sync or fs.readFile() for async.');
ctx.user('What about streams?');
const { snapshot: snap2 } = await ctx.build();
```

Each `build()` produces an independent immutable snapshot. The context itself is mutable — you keep pushing messages and rebuilding.

### Batch inserts

For importing conversation history from a database or API, use `push()` with an array of items:

```typescript
ctx.push('history', [
  { content: 'Hello!', role: 'user' },
  { content: 'Hi there! How can I help?', role: 'assistant' },
  { content: 'Tell me about TypeScript.', role: 'user' },
  { content: 'TypeScript is a typed superset of JavaScript...', role: 'assistant' },
]);
```

### Pinning important messages

Pin messages that should never be evicted during overflow:

```typescript
ctx.push('history', [
  {
    content: 'IMPORTANT: The user prefers Python examples.',
    role: 'user',
    pinned: true,
  },
]);
```

Pinned items survive truncation and sliding-window strategies. They still count toward the token budget.

## Overflow in practice

As the conversation grows, the history slot will eventually exceed its budget. The `chat` preset uses `summarize` as the overflow strategy.

The summarizer produces **budget-aware** output — each summary call receives a target token count so the LLM fills the available space instead of producing a terse paragraph. When `preserveLastN` is omitted, the number of verbatim recent items scales with the budget automatically.

::: tip Proactive compression for long conversations
Set `proactiveThreshold` to start compressing before the slot is full. This spreads compression across multiple builds instead of one drastic pass:
```typescript
overflowConfig: {
  proactiveThreshold: 0.85,  // compress at 85% utilization
}
```
:::

::: warning
The `summarize` strategy requires a summarization function to be injected (via `slotmuxProvider` or `overflowConfig.summarizer`). For simpler setups, override the history slot to use `truncate` or `sliding-window`.
:::

### Using truncation instead

```typescript
const { config } = createContext({
  model: 'gpt-5.4-mini',
  preset: 'chat',
  reserveForResponse: 4096,
  lazyContentItemTokens: true,
  slots: {
    history: {
      priority: 50,
      budget: { flex: true },
      overflow: 'truncate',        // drop oldest messages first
      defaultRole: 'user',
      position: 'after',
    },
  },
});
```

### Using a sliding window

Keep the last N messages, then truncate if still over budget:

```typescript
slots: {
  history: {
    priority: 50,
    budget: { flex: true },
    overflow: 'sliding-window',
    overflowConfig: { windowSize: 20 },
    defaultRole: 'user',
    position: 'after',
  },
}
```

### Monitoring overflow

Check `snapshot.meta` after each build to see if overflow occurred:

```typescript
const { snapshot } = await ctx.build();

for (const [name, slot] of Object.entries(snapshot.meta.slots)) {
  if (slot.overflowTriggered) {
    console.log(`${name}: ${slot.evictedCount} items evicted`);
  }
  console.log(`${name}: ${slot.usedTokens}/${slot.budgetTokens} tokens`);
}

if (snapshot.meta.warnings.length > 0) {
  console.warn('Warnings:', snapshot.meta.warnings);
}
```

## Streaming builds

Slotmux supports streaming builds that emit compiled messages per slot as they become ready, rather than waiting for the entire pipeline to finish:

```typescript
const stream = ctx.buildStream();

for await (const event of stream) {
  switch (event.type) {
    case 'slot:ready':
      console.log(`Slot "${event.slot}" ready:`, event.messages.length, 'messages');
      break;
    case 'complete':
      console.log('Build complete:', event.result.snapshot.meta.totalTokens, 'tokens');
      break;
    case 'error':
      console.error('Build failed:', event.error);
      break;
  }
}
```

Slots are emitted in compile order (`before` → `interleave` → `after`), so you can start sending the system prompt to the LLM while the history slot is still being processed.

## Checkpoints and rollback

Save and restore context state for branching conversations or implementing undo:

```typescript
const checkpoint = ctx.checkpoint();

ctx.user('Take me down path A...');
const { snapshot: pathA } = await ctx.build();

ctx.restore(checkpoint);

ctx.user('Actually, let me try path B...');
const { snapshot: pathB } = await ctx.build();
```

This is useful for:
- **Speculative generation** — try multiple continuations, pick the best one.
- **Undo** — let users delete their last message.
- **Branching** — fork a conversation into multiple threads.

## Provider formatting

Snapshots contain provider-agnostic compiled messages. Convert them for your API:

```typescript
import { formatOpenAIMessages } from '@slotmux/providers';

const { snapshot } = await ctx.build();
const messages = formatOpenAIMessages(snapshot.messages);

const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'gpt-5.4-mini',
    messages,
  }),
});
```

## Custom fact extraction

The progressive summarizer automatically extracts structured facts from LLM output using `FACT:` lines in the summarization prompt. For domain-specific use cases, you can inject a dedicated extraction function that runs as a **separate pass** before summarization:

```typescript
import { createContext, Context } from 'slotmux';
import { openai } from '@slotmux/providers';

const { config } = createContext({
  model: 'gpt-5.4-mini',
  preset: 'chat',
  slotmuxProvider: openai({ apiKey: process.env.OPENAI_API_KEY! }),
  slots: {
    history: {
      priority: 50,
      budget: { flex: true },
      overflow: 'summarize',
      overflowConfig: {
        extractFacts: async ({ text }) => {
          // Domain-specific: extract order IDs and product mentions
          const facts = [];
          for (const m of text.matchAll(/order\s*#(\w+)/gi)) {
            facts.push({
              subject: 'user',
              predicate: 'placed_order',
              value: m[1]!,
              sourceItemId: 'custom',
              confidence: 1.0,
              createdAt: Date.now(),
            });
          }
          return facts;
        },
      },
      defaultRole: 'user',
      position: 'after',
    },
  },
});
```

The extracted facts merge with any `FACT:` lines from the summarization output. Both sources accumulate in the fact store and are rendered as a `Known facts:` block at the start of the summarized context.

For an LLM-backed default that uses a structured extraction prompt:

```typescript
import { createDefaultExtractFacts } from '@slotmux/compression';

overflowConfig: {
  extractFacts: createDefaultExtractFacts(mySummarizeTextFn),
}
```

## Production checklist

- **Set `reserveForResponse`** — always leave room for the model's reply.
- **Enable `lazyContentItemTokens: true`** — ensures accurate token counting.
- **Choose an overflow strategy** — don't rely on the default `summarize` unless you've configured a summarizer.
- **Monitor `snapshot.meta`** — log utilization and warnings for observability.
- **Use `@slotmux/plugin-otel`** — for OpenTelemetry traces across builds.

## Next

- [Concepts: Slots](/concepts/slots) — deep dive into slot configuration.
- [Concepts: Overflow](/concepts/overflow) — all eight overflow strategies.
- [Agent with tools](./agent-with-tools) — add tool calling to your chatbot.
