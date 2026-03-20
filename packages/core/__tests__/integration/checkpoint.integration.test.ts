import { describe, expect, it } from 'vitest';

import {
  Context,
  createContext,
  InvalidConfigError,
  type ContextCheckpoint,
} from '../../src/index.js';

describe('checkpoint / restore (§12.2 — Phase 9.3)', () => {
  it('checkpoint → modify → restore yields original slot contents', () => {
    const { config } = createContext({
      model: 'gpt-4o',
      preset: 'chat',
    });
    const ctx = Context.fromParsedConfig(config);

    ctx.system('sys-msg');
    ctx.user('u1');

    const cp = ctx.checkpoint();
    expect(cp.version).toBe('1.0');
    expect(cp.seq).toBe(1);
    expect(new Set(cp.changedSincePrevious)).toEqual(new Set(['system', 'history']));

    ctx.user('u2');
    expect(ctx.getItems('history').map((i) => i.content)).toEqual(['u1', 'u2']);

    ctx.restore(cp);

    expect(ctx.getItems('system').map((i) => i.content)).toEqual(['sys-msg']);
    expect(ctx.getItems('history').map((i) => i.content)).toEqual(['u1']);
  });

  it('second checkpoint with no mutations reports empty changedSincePrevious', () => {
    const { config } = createContext({
      model: 'gpt-4o',
      preset: 'chat',
    });
    const ctx = Context.fromParsedConfig(config);
    ctx.user('only');
    const first = ctx.checkpoint();
    const second = ctx.checkpoint();
    expect(second.seq).toBe(first.seq + 1);
    expect(second.changedSincePrevious).toEqual([]);
    expect(second.slots['history']).toHaveLength(1);
  });

  it('restore rejects unsupported checkpoint version', () => {
    const { config } = createContext({
      model: 'gpt-4o',
      preset: 'chat',
    });
    const ctx = Context.fromParsedConfig(config);
    const bad = {
      version: '0.1',
      seq: 1,
      changedSincePrevious: [],
      slots: Object.fromEntries(
        ctx.registeredSlots.map((s) => [s, [] as const]),
      ),
    } as unknown as ContextCheckpoint;
    expect(() => ctx.restore(bad)).toThrow(InvalidConfigError);
  });
});
