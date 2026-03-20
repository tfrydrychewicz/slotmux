/**
 * Subpath `contextcraft/reactive` — signals and {@link reactiveContext} (§14.2 — Phase 12.2).
 *
 * @packageDocumentation
 */

export {
  reactiveContext,
  ReactiveContext,
  type ReactiveContextInit,
} from './reactive/reactive-context.js';
export {
  ref,
  computedRef,
  type Ref,
  type ReadonlyRef,
  type RefUnsubscribe,
} from './reactive/ref.js';
