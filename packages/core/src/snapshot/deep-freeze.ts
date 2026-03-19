/**
 * Recursive {@link Object.freeze} for snapshot immutability (ADR-002 — Phase 5.5).
 *
 * @packageDocumentation
 */

/**
 * Freezes `value` and recursively freezes plain objects and array elements.
 * Skips `null`, primitives, and already-frozen objects.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const el of value) {
      if (el !== null && typeof el === 'object') {
        deepFreeze(el);
      }
    }
    return value;
  }
  const rec = value as Record<string, unknown>;
  for (const k of Object.keys(rec)) {
    const v = rec[k];
    if (v !== null && typeof v === 'object') {
      deepFreeze(v);
    }
  }
  return value;
}
