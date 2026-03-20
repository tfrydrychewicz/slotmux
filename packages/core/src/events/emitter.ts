/**
 * Type-safe synchronous event emitter with discriminated-union dispatch (§13.1 / Phase 7.1).
 *
 * @packageDocumentation
 */

/** Minimal shape for events routed by a string `type` discriminator. */
export type EventWithTypeField = { readonly type: string };

type ListenerFn<TEvent extends EventWithTypeField> = (event: TEvent) => void;

/**
 * Synchronous {@link https://en.wikipedia.org/wiki/Observer_pattern | observer} for a discriminated union.
 *
 * - {@link TypedEventEmitter.emit} runs all listeners for `event.type` in registration order.
 * - Listener exceptions are swallowed so one bad handler does not block others.
 */
export class TypedEventEmitter<TEvent extends EventWithTypeField> {
  private readonly listeners = new Map<string, Set<ListenerFn<TEvent>>>();

  /**
   * Subscribe to a specific event `type`. Same handler reference can be registered once per type.
   */
  on<K extends TEvent['type']>(
    type: K,
    handler: (event: Extract<TEvent, { type: K }>) => void,
  ): void {
    let set = this.listeners.get(type);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler as ListenerFn<TEvent>);
  }

  /**
   * Remove a handler previously passed to {@link on} or {@link once}.
   */
  off<K extends TEvent['type']>(
    type: K,
    handler: (event: Extract<TEvent, { type: K }>) => void,
  ): void {
    const set = this.listeners.get(type);
    if (set === undefined) {
      return;
    }
    set.delete(handler as ListenerFn<TEvent>);
    if (set.size === 0) {
      this.listeners.delete(type);
    }
  }

  /**
   * Subscribe for a single delivery; the handler removes itself before running user code.
   */
  once<K extends TEvent['type']>(
    type: K,
    handler: (event: Extract<TEvent, { type: K }>) => void,
  ): void {
    const wrapped = ((event: TEvent) => {
      this.off(type, wrapped as (event: Extract<TEvent, { type: K }>) => void);
      handler(event as Extract<TEvent, { type: K }>);
    }) as (event: Extract<TEvent, { type: K }>) => void;
    this.on(type, wrapped);
  }

  /**
   * Deliver `event` to all listeners for `event.type` synchronously.
   */
  emit(event: TEvent): void {
    const set = this.listeners.get(event.type);
    if (set === undefined || set.size === 0) {
      return;
    }
    const snapshot = [...set];
    for (const listener of snapshot) {
      try {
        listener(event);
      } catch {
        /* error isolation — do not break other listeners */
      }
    }
  }
}
