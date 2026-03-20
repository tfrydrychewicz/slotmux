# @contextcraft/react

React 18+ hooks for [`contextcraft/reactive`](https://github.com/tfrydrychewicz/contextcraft) using [`useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore) so updates work with **Concurrent React** and **Strict Mode** (subscribe in `useEffect` alone is easy to get wrong).

## Install

```bash
pnpm add @contextcraft/react contextcraft react
```

## Usage

Keep a **stable** `ReactiveContext` instance (e.g. `useRef` + lazy init, or a store):

```tsx
import { useMemo, useRef } from 'react';
import { reactiveContext } from 'contextcraft/reactive';
import {
  useReactiveContextMeta,
  useReactiveContextUtilization,
  useReactiveContextBuildError,
} from '@contextcraft/react';

function Panel() {
  const ctxRef = useRef<ReturnType<typeof reactiveContext> | null>(null);
  if (ctxRef.current === null) {
    ctxRef.current = reactiveContext({
      model: 'gpt-4o-mini',
      preset: 'chat',
      strictTokenizerPeers: false,
    });
  }
  const ctx = ctxRef.current;

  const meta = useReactiveContextMeta(ctx);
  const utilization = useReactiveContextUtilization(ctx);
  const buildError = useReactiveContextBuildError(ctx);

  if (buildError) return <div role="alert">{buildError.message}</div>;
  if (!meta) return <div>Compiling…</div>;

  return <div>Utilization: {(utilization * 100).toFixed(0)}%</div>;
}
```

## API

| Hook | Source |
|------|--------|
| `useReactiveContextMeta(ctx)` | `ctx.meta.value` |
| `useReactiveContextUtilization(ctx)` | `ctx.utilization.value` |
| `useReactiveContextBuildError(ctx)` | `ctx.buildError.value` |

## Requirements

- **React** `^18 || ^19`
- **contextcraft** (same major as this package in monorepo releases)
