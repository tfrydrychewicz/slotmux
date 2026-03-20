# React integration

Slotmux provides `@slotmux/react` — a thin hooks package that bridges `ReactiveContext` signals to React 18+ via `useSyncExternalStore`. You get tear-free reads of `meta`, `utilization`, and `buildError` with zero manual subscriptions.

## Install

```bash
pnpm add slotmux @slotmux/react
```

`@slotmux/react` has `react` as a peer dependency (`^18.0.0 || ^19.0.0`) and `slotmux` as a direct dependency.

## Core idea

The reactive layer lives in the `slotmux/reactive` subpath export. It wraps a mutable `Context` with:

- **`meta`** — a signal holding the latest `SnapshotMeta` (or `undefined` before the first build).
- **`utilization`** — a derived signal (`meta.utilization ?? 0`).
- **`buildError`** — a signal holding the last build failure (cleared on success).
- **Debounced auto-rebuild** — mutating calls (`user`, `push`, `system`, …) schedule a `build()` after a configurable delay (default 50 ms).

`@slotmux/react` hooks subscribe to these signals using `useSyncExternalStore`, so React re-renders only when values actually change — compatible with Concurrent Mode and Suspense boundaries.

## Create a stable `ReactiveContext`

The most important rule: **the `ReactiveContext` instance must be stable across renders.** If you recreate it on every render, the hooks will subscribe/unsubscribe in a loop and the debounced builds will never settle.

Use `useRef` or `useMemo` (with an empty dependency array) to hold it:

```typescript
import { useMemo } from 'react';
import { reactiveContext } from 'slotmux/reactive';
import { SlotOverflow } from 'slotmux';

function useChatContext() {
  return useMemo(
    () =>
      reactiveContext({
        model: 'gpt-4o-mini',
        maxTokens: 128_000,
        reserveForResponse: 4096,
        strictTokenizerPeers: false,
        debounceMs: 50,
        slots: {
          system: {
            priority: 100,
            budget: { fixed: 2000 },
            overflow: SlotOverflow.ERROR,
            defaultRole: 'system',
            position: 'before',
          },
          history: {
            priority: 50,
            budget: { flex: true },
            overflow: SlotOverflow.TRUNCATE,
            defaultRole: 'user',
            position: 'after',
          },
        },
      }),
    [],
  );
}
```

Dispose on unmount if you need cleanup:

```typescript
import { useEffect, useMemo } from 'react';
import { reactiveContext } from 'slotmux/reactive';

function useChatContext(init) {
  const ctx = useMemo(() => reactiveContext(init), []);

  useEffect(() => {
    return () => ctx.dispose();
  }, [ctx]);

  return ctx;
}
```

## Hooks

### `useReactiveContextMeta`

Returns `SnapshotMeta | undefined`. Starts as `undefined` while the initial build runs (usually resolves within a macrotask).

```typescript
import { useReactiveContextMeta } from '@slotmux/react';

function ContextStats({ ctx }) {
  const meta = useReactiveContextMeta(ctx);

  if (!meta) return <p>Building…</p>;

  return (
    <dl>
      <dt>Tokens</dt>
      <dd>{Number(meta.totalTokens)} / {Number(meta.totalBudget)}</dd>
      <dt>Utilization</dt>
      <dd>{(meta.utilization * 100).toFixed(1)}%</dd>
      <dt>Build time</dt>
      <dd>{meta.buildTimeMs} ms</dd>
    </dl>
  );
}
```

### `useReactiveContextUtilization`

Returns a `number` (0–1). Convenience shortcut for `meta?.utilization ?? 0`.

```typescript
import { useReactiveContextUtilization } from '@slotmux/react';

function UtilizationBar({ ctx }) {
  const utilization = useReactiveContextUtilization(ctx);
  const pct = (utilization * 100).toFixed(0);

  return (
    <div role="meter" aria-valuenow={utilization} aria-valuemin={0} aria-valuemax={1}>
      <div style={{ width: `${pct}%`, background: utilization > 0.9 ? '#e53e3e' : '#38a169' }} />
      <span>{pct}%</span>
    </div>
  );
}
```

### `useReactiveContextBuildError`

Returns `Error | undefined`. Set when a build fails (initial, debounced, explicit, or streaming); cleared on the next success.

```typescript
import { useReactiveContextBuildError } from '@slotmux/react';

function BuildError({ ctx }) {
  const error = useReactiveContextBuildError(ctx);

  if (!error) return null;

  return (
    <div role="alert" style={{ color: '#e53e3e' }}>
      Build failed: {error.message}
    </div>
  );
}
```

## Full example: chat component

```typescript
import { useCallback, useMemo, useState } from 'react';
import { reactiveContext, type ReactiveContext } from 'slotmux/reactive';
import { SlotOverflow } from 'slotmux';
import { formatOpenAIMessages } from '@slotmux/providers';
import {
  useReactiveContextMeta,
  useReactiveContextUtilization,
  useReactiveContextBuildError,
} from '@slotmux/react';

function useChat(): ReactiveContext {
  return useMemo(
    () =>
      reactiveContext({
        model: 'gpt-4o-mini',
        maxTokens: 128_000,
        reserveForResponse: 4096,
        strictTokenizerPeers: false,
        slots: {
          system: {
            priority: 100,
            budget: { fixed: 2000 },
            overflow: SlotOverflow.ERROR,
            defaultRole: 'system',
            position: 'before',
          },
          history: {
            priority: 50,
            budget: { flex: true },
            overflow: SlotOverflow.TRUNCATE,
            defaultRole: 'user',
            position: 'after',
          },
        },
        onBuildError: (err) => console.error('[slotmux]', err),
      }),
    [],
  );
}

function Chat() {
  const ctx = useChat();
  const meta = useReactiveContextMeta(ctx);
  const utilization = useReactiveContextUtilization(ctx);
  const buildError = useReactiveContextBuildError(ctx);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([]);

  const send = useCallback(async () => {
    if (!input.trim()) return;

    ctx.user(input);
    setMessages((prev) => [...prev, { role: 'user', text: input }]);
    setInput('');

    const { snapshot } = await ctx.build();
    const formatted = formatOpenAIMessages(snapshot.messages);

    const reply = await callYourLLM(formatted);

    ctx.assistant(reply);
    setMessages((prev) => [...prev, { role: 'assistant', text: reply }]);
  }, [ctx, input]);

  return (
    <div>
      <ul>
        {messages.map((m, i) => (
          <li key={i}><b>{m.role}:</b> {m.text}</li>
        ))}
      </ul>

      <input value={input} onChange={(e) => setInput(e.target.value)} />
      <button onClick={send}>Send</button>

      {buildError && <p style={{ color: 'red' }}>{buildError.message}</p>}

      {meta && (
        <footer>
          {Number(meta.totalTokens)} / {Number(meta.totalBudget)} tokens
          ({(utilization * 100).toFixed(1)}%)
          · {meta.buildTimeMs} ms
        </footer>
      )}
    </div>
  );
}
```

## `reactiveContext` vs imperative `Context`

| | `reactiveContext` | `Context` |
| --- | --- | --- |
| **Auto-rebuild** | Debounced after every mutation | Manual — call `build()` yourself |
| **Signals** | `meta`, `utilization`, `buildError` | None — `build()` returns the snapshot |
| **React hooks** | `useReactiveContextMeta`, etc. | Not applicable |
| **When to use** | UI components that display live context stats | Server-side / scripting / full control over build timing |

Use `Context` directly when you don't need live UI updates — it avoids the debounce overhead entirely. You can always access the underlying `Context` via `ctx.context` if you need escape-hatch access.

## `buildStream` in React

`ReactiveContext.buildStream()` returns a `ContextBuildStream` just like `Context.buildStream()`. When the stream's `finished` promise resolves, `meta` and `buildError` are updated automatically (subject to the generation guard — a newer build supersedes older results).

```typescript
const stream = ctx.buildStream();

stream.on('slot:ready', (e) => {
  // A slot's messages are ready — you could start streaming to the LLM
});

const result = await stream.finished;
// meta.value is now updated
```

Be cautious: if you call `buildStream()` from a click handler while a debounced build is pending, the debounce is cancelled and the stream takes priority.

## Server-side rendering

`meta.value` is `undefined` until the first asynchronous build completes. All three hooks use `undefined` / `0` as the server snapshot (third argument to `useSyncExternalStore`), so SSR renders a "loading" state. After hydration, the initial build settles and hooks re-render with real data.

If you need `meta` available during SSR, run an explicit `await ctx.build()` in your data-fetching layer (e.g. Next.js `getServerSideProps` or React Server Components) and pass the `SnapshotMeta` as a prop instead of reading it from the hook.

## Ref API

The signals under the hood are `Ref<T>` objects with `.value` and `.subscribe()`:

```typescript
interface Ref<T> {
  get value(): T;
  set value(next: T);
  subscribe(listener: () => void): () => void;
}
```

If you need to subscribe outside of React (e.g. in a side-effect or vanilla JS callback), use `.subscribe` directly:

```typescript
const unsub = ctx.meta.subscribe(() => {
  console.log('New meta:', ctx.meta.value);
});
```

The `Ref` objects carry a `__v_isRef` flag so Vue 3 treats them as native refs — see the [Vue guide](./vue).

## Next steps

- [Vue integration](./vue) — `reactiveContext` with `computed` / `watch`.
- [Angular integration](./angular) — injectable service with Signals or `async` pipe.
- [Reactive context (framework-agnostic)](./reactive-context) — deeper dive on debounce, concurrency, and error handling.
- [Streaming build](./streaming-build) — `buildStream()` for progressive LLM delivery.
- [Concepts: Snapshots](/concepts/snapshots) — what's inside `SnapshotMeta`.
