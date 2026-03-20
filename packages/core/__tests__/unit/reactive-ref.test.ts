/**
 * Phase 12.2 — ref / computed primitives (mock signal system for reactive context).
 *
 * @packageDocumentation
 */

import { describe, expect, it, vi } from 'vitest';

import { computedRef, ref } from '../../src/reactive/ref.js';

describe('reactive ref (Phase 12.2)', () => {
  it('ref notifies subscribers when value changes', () => {
    const r = ref(1);
    const fn = vi.fn();
    r.subscribe(fn);
    r.value = 2;
    expect(fn).toHaveBeenCalledTimes(1);
    r.value = 2;
    expect(fn).toHaveBeenCalledTimes(1);
    r.value = 3;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe stops notifications', () => {
    const r = ref(0);
    const fn = vi.fn();
    const off = r.subscribe(fn);
    off();
    r.value = 1;
    expect(fn).not.toHaveBeenCalled();
  });

  it('computedRef tracks source and exposes __v_isRef', () => {
    const src = ref({ n: 1 });
    const c = computedRef(src, (s) => s.n * 2);
    expect(c.value).toBe(2);
    expect((c as { __v_isRef?: boolean }).__v_isRef).toBe(true);
    const fn = vi.fn();
    c.subscribe(fn);
    src.value = { n: 5 };
    expect(c.value).toBe(10);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('ref exposes __v_isRef for Vue interop', () => {
    const r = ref('x');
    expect((r as { __v_isRef?: boolean }).__v_isRef).toBe(true);
  });
});
