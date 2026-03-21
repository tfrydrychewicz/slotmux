# Streaming build

`ctx.buildStream()` compiles the context window **progressively** — emitting each slot's messages as soon as they're ready, rather than waiting for the entire build to finish. This lets you start streaming tokens to the LLM before overflow resolution is complete for all slots.

## When streaming helps

Streaming build is most useful when:

- **Multiple high-priority slots are independent** — system instructions can be sent to the LLM while history is still being overflow-resolved.
- **Late-arriving content** — RAG results or tool outputs arrive asynchronously after the build starts. Slots not yet emitted can absorb new content mid-stream.
- **Large context windows** — building 200K+ token contexts with compression takes time. Streaming lets the LLM start processing earlier.

For small contexts (under 10K tokens) or contexts with few slots, `build()` is simpler and equally fast.

## Basic usage

```typescript
import { createContext, Context } from 'slotmux';

const { config } = createContext({
  model: 'gpt-5.4',
  preset: 'chat',
});
const ctx = Context.fromParsedConfig(config);

ctx.system('You are a helpful assistant.');
ctx.user('Hello!');

const stream = ctx.buildStream();

stream.on('slot:ready', (event) => {
  console.log(`Slot "${event.slot}" ready:`, event.messages.length, 'messages');
});

stream.on('complete', (event) => {
  const { snapshot } = event.result;
  console.log(`Build complete: ${snapshot.meta.utilization * 100}% utilization`);
});

stream.on('error', (event) => {
  console.error('Build failed:', event.error);
});

const result = await stream.finished;
```

## Stream events

`ContextBuildStream` emits three event types:

| Event | When | Payload |
| --- | --- | --- |
| `slot:ready` | A slot's messages are compiled and finalized | `{ slot: string, messages: CompiledMessage[] }` |
| `complete` | All slots are done, snapshot is built | `{ result: { snapshot, context } }` |
| `error` | The build failed | `{ error: unknown }` |

Events use the same `TypedEventEmitter` pattern as context events — subscribe with `on()`, unsubscribe with `off()`, one-shot with `once()`.

## The `finished` promise

`stream.finished` resolves when the build completes successfully, returning the same `{ snapshot, context }` result as `build()`:

```typescript
const stream = ctx.buildStream();
const { snapshot } = await stream.finished;
```

If the build fails, `finished` rejects with the error.

## Slot emission order

Slots are emitted in **compile order** — the same order they appear in the final message array:

1. `before` slots (priority descending)
2. `interleave` slots (order ascending, then priority descending)
3. `after` slots (priority descending)

With the `chat` preset, you'll get `slot:ready` for `system` first, then `history`.

## Late-arriving content

Between slot emissions, a macrotask yields so your code can push new content into slots that haven't been emitted yet:

```typescript
const stream = ctx.buildStream();

stream.on('slot:ready', async (event) => {
  if (event.slot === 'system') {
    // System prompt is ready — RAG results arrive now
    ctx.push('rag', [
      { content: 'Retrieved document 1...', role: 'user' },
      { content: 'Retrieved document 2...', role: 'user' },
    ]);
    // The 'rag' slot hasn't been emitted yet, so these items
    // will be included when it's processed
  }
});

await stream.finished;
```

Once a slot is emitted, its content is **frozen** for the rest of the build. Content pushed to an already-emitted slot won't appear in the current build's snapshot.

## Frozen slots

After a slot emits `slot:ready`, the build holds its items fixed. When later slots are processed through budget resolution and overflow, the frozen slot's token usage is accounted for but its items are not touched. This ensures:

- Messages you've already started streaming to the LLM don't change.
- Token budgets for remaining slots are computed against the actual frozen content.

## Comparison with `build()`

| Feature | `build()` | `buildStream()` |
| --- | --- | --- |
| Return type | `Promise<{ snapshot, context }>` | `ContextBuildStream` (event emitter + `finished` promise) |
| Slot delivery | All at once in the snapshot | Progressive, one `slot:ready` per slot |
| Late content | Not possible (build is atomic) | Push to un-emitted slots mid-build |
| Snapshot | Available when the promise resolves | Available on `complete` / `stream.finished` |
| Use case | Simple builds, tests, scripts | Real-time UIs, large contexts, async content |

Both go through the same budget resolution and overflow pipeline. The snapshot produced by `buildStream()` is identical to what `build()` would produce (given the same content at build time).

## Progressive LLM streaming

Combine streaming build with LLM token streaming for the fastest time-to-first-token:

```typescript
import { formatOpenAIMessages } from '@slotmux/providers';

const stream = ctx.buildStream();
const messagesSoFar: CompiledMessage[] = [];

stream.on('slot:ready', (event) => {
  messagesSoFar.push(...event.messages);

  // Start streaming to the LLM as soon as the system prompt is ready
  if (event.slot === 'system') {
    startLLMStream(formatOpenAIMessages(messagesSoFar));
  }
});

stream.on('complete', (event) => {
  // Full snapshot available for logging/metrics
  recordMetrics(event.result.snapshot.meta);
});

await stream.finished;
```

## Error handling

Errors during the build are emitted as `error` events and reject `stream.finished`:

```typescript
const stream = ctx.buildStream();

stream.on('error', (event) => {
  console.error('Build failed:', event.error);
});

try {
  await stream.finished;
} catch (err) {
  // Same error as the 'error' event
}
```

## With reactive context

`ReactiveContext` exposes `buildStream()` too. It cancels any pending debounced build, increments the generation counter, and applies the snapshot metadata only if the generation still matches when the stream completes:

```typescript
import { reactiveContext } from 'slotmux/reactive';

const ctx = reactiveContext({
  model: 'gpt-5.4',
  preset: 'chat',
  debounceMs: 100,
});

const stream = ctx.buildStream();
stream.on('slot:ready', (event) => {
  // Progressive delivery
});
await stream.finished;
// ctx.meta.value is now updated
```

## Build parameters

Pass `overrides` to customize a specific streaming build:

```typescript
const stream = ctx.buildStream({
  overrides: {
    reserveForResponse: 8192,
  },
  previousSnapshot: lastSnapshot,
});
```

All options from `build()` work with `buildStream()` — `providerAdapters`, `previousSnapshot`, `structuralSharing`, `pluginManager`, `operationId`, and [`forceCompress`](/concepts/overflow#forced-compression):

```typescript
const stream = ctx.buildStream({
  overrides: {
    forceCompress: true, // compress all eligible slots, even within budget
  },
});
```

## Next

- [Reactive context](./reactive-context) — debounced auto-rebuild with signals.
- [Events & observability](./events-and-observability) — monitoring build events.
- [End-to-end chatbot](./chatbot) — streaming build in a real chat application.
