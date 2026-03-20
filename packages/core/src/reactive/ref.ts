/**
 * Minimal ref / computed primitives — Vue 3–style `.value` + subscribe (§14.2 — Phase 12.2).
 *
 * @packageDocumentation
 */

/** Unsubscribe function returned by {@link Ref.subscribe}. */
export type RefUnsubscribe = () => void;

/**
 * Writable reactive box. Optional `__v_isRef` helps Vue 3 treat this like a native `ref()`.
 */
export interface Ref<T> {
  get value(): T;
  set value(next: T);
  subscribe(listener: () => void): RefUnsubscribe;
}

/** Read-only view of a {@link Ref} (e.g. derived state). */
export type ReadonlyRef<T> = Omit<Ref<T>, 'value'> & { readonly value: T };

const VUE_IS_REF = '__v_isRef' as const;

function attachVueRefFlag(target: object): void {
  Object.defineProperty(target, VUE_IS_REF, { value: true, enumerable: false });
}

/**
 * Creates a reactive reference. Listeners run synchronously after `value` changes.
 */
export function ref<T>(initial: T): Ref<T> {
  let value = initial;
  const listeners = new Set<() => void>();

  const self = {
    get value(): T {
      return value;
    },
    set value(next: T) {
      if (Object.is(next, value)) {
        return;
      }
      value = next;
      for (const fn of [...listeners]) {
        try {
          fn();
        } catch {
          /* isolate listener errors */
        }
      }
    },
    subscribe(listener: () => void): RefUnsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  attachVueRefFlag(self);
  return self;
}

/**
 * Derived ref that updates when `source` emits. The `getter` receives the current source value.
 */
export function computedRef<T, R>(source: Ref<T>, getter: (value: T) => R): ReadonlyRef<R> {
  const out = ref(getter(source.value));

  source.subscribe(() => {
    out.value = getter(source.value);
  });

  const self = {
    get value(): R {
      return out.value;
    },
    subscribe: ((listener: () => void) => out.subscribe(listener)) as ReadonlyRef<R>['subscribe'],
  };
  attachVueRefFlag(self);
  return self;
}
