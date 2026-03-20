/**
 * @packageDocumentation
 */

import { describe, expect, it } from 'vitest';

import { VERSION, otelPlugin } from './index.js';

describe('@slotmux/plugin-otel', () => {
  it('exports VERSION', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('otelPlugin returns a ContextPlugin', () => {
    const p = otelPlugin();
    expect(p.name).toBe('otel');
    expect(p.version).toBe(VERSION);
    expect(typeof p.onEvent).toBe('function');
  });
});
