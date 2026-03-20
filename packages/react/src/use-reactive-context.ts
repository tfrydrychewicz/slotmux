/**
 * React 18+ integration for {@link ReactiveContext} via `useSyncExternalStore` (§14.2).
 *
 * @packageDocumentation
 */

import type { ReactiveContext } from 'contextcraft/reactive';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribes to {@link ReactiveContext.meta} with concurrent-safe external store semantics.
 * Pass a **stable** `ctx` reference (e.g. `useMemo` / `useRef`) across renders.
 */
export function useReactiveContextMeta(ctx: ReactiveContext) {
  return useSyncExternalStore(
    useCallback((onStoreChange) => ctx.meta.subscribe(onStoreChange), [ctx]),
    () => ctx.meta.value,
    () => ctx.meta.value,
  );
}

/**
 * Subscribes to {@link ReactiveContext.utilization}.
 */
export function useReactiveContextUtilization(ctx: ReactiveContext): number {
  return useSyncExternalStore(
    useCallback((onStoreChange) => ctx.utilization.subscribe(onStoreChange), [ctx]),
    () => ctx.utilization.value,
    () => ctx.utilization.value,
  );
}

/**
 * Subscribes to {@link ReactiveContext.buildError} (undefined after a successful build).
 */
export function useReactiveContextBuildError(ctx: ReactiveContext): Error | undefined {
  return useSyncExternalStore(
    useCallback((onStoreChange) => ctx.buildError.subscribe(onStoreChange), [ctx]),
    () => ctx.buildError.value,
    () => ctx.buildError.value,
  );
}
