import { describe, expect, it, vi } from 'vitest';

import { InvalidConfigError } from '../../src/errors.js';
import { PluginManager } from '../../src/plugins/plugin-manager.js';
import { OverflowEngine } from '../../src/slots/overflow-engine.js';
import { createContentId, toTokenCount } from '../../src/types/branded.js';
import type { SlotConfig, SlotOverflowStrategy } from '../../src/types/config.js';
import type { ContentItem, CompiledMessage } from '../../src/types/content.js';
import type { ContextPlugin, ResolvedSlot } from '../../src/types/plugin.js';

const baseSlots: Record<string, SlotConfig> = {
  history: { priority: 50, budget: { fixed: 100 } },
};

function makeItem(content: string, slot = 'history'): ContentItem {
  return {
    id: createContentId(),
    role: 'user',
    content,
    slot,
    createdAt: 1,
  };
}

function manager(): PluginManager {
  return new PluginManager({
    getSlots: () => baseSlots,
    tokenCounter: { count: (s) => toTokenCount(Math.ceil(s.length / 4)) },
  });
}

describe('PluginManager', () => {
  it('register calls install with PluginContext', async () => {
    const install = vi.fn();
    const m = manager();
    await m.register({
      name: 'p',
      version: '1.0.0',
      install,
    });
    expect(install).toHaveBeenCalledTimes(1);
    const ctx = install.mock.calls[0]![0]!;
    expect(ctx.getSlots()).toEqual(baseSlots);
    expect(ctx.tokenCounter).toBeDefined();
    expect(ctx.registerOverflowStrategy).toBeDefined();
    expect(ctx.registerCompressor).toBeDefined();
    expect(ctx.logger).toBeDefined();
  });

  it('throws when registering the same plugin instance twice', async () => {
    const m = manager();
    const p: ContextPlugin = { name: 'x', version: '1.0.0' };
    await m.register(p);
    await expect(m.register(p)).rejects.toThrow(InvalidConfigError);
  });

  it('throws when registerCompressor name does not match compressor.name', async () => {
    const m = manager();
    await expect(
      m.register({
        name: 'p',
        version: '1.0.0',
        install: (ctx) => {
          ctx.registerCompressor('a', {
            name: 'b',
            compress: (items) => items,
          });
        },
      }),
    ).rejects.toThrow(InvalidConfigError);
  });

  it('rolls back strategy registrations when install throws', async () => {
    const m = manager();
    const p: ContextPlugin = {
      name: 'bad',
      version: '1.0.0',
      install: (ctx) => {
        ctx.registerOverflowStrategy('custom-boom', () => []);
        throw new Error('install failed');
      },
    };
    await expect(m.register(p)).rejects.toThrow('install failed');
    expect(m.getNamedOverflowStrategiesForEngine()['custom-boom']).toBeUndefined();
    expect(m.getPlugins()).toHaveLength(0);
  });

  it('unregister calls destroy and removes overflow registrations', async () => {
    const destroy = vi.fn();
    const m = manager();
    const p: ContextPlugin = {
      name: 'p',
      version: '1.0.0',
      install: (ctx) => {
        ctx.registerOverflowStrategy('mine', (items) => items.slice(0, 1));
      },
      destroy,
    };
    await m.register(p);
    expect(m.getNamedOverflowStrategiesForEngine()['mine']).toBeDefined();
    await m.unregister(p);
    expect(destroy).toHaveBeenCalled();
    expect(m.getNamedOverflowStrategiesForEngine()['mine']).toBeUndefined();
    expect(m.getPlugins()).toHaveLength(0);
  });

  it('registerCompressor exposes adapter under the same name for OverflowEngine', async () => {
    const m = manager();
    await m.register({
      name: 'c',
      version: '1.0.0',
      install: (ctx) => {
        ctx.registerCompressor('squash', {
          name: 'squash',
          compress: (items, _b, c) =>
            c.slotName === 'history' ? items.slice(-1) : items,
        });
      },
    });
    expect(m.getCompressor('squash')).toBeDefined();
    const engine = new OverflowEngine({
      countTokens: () => 100,
      namedStrategies: m.getNamedOverflowStrategiesForEngine(),
    });
    const items = [makeItem('a'), makeItem('b')];
    const out = await engine.resolve(
      [
        {
          name: 'history',
          priority: 50,
          budgetTokens: 1,
          content: items,
          config: {
            ...baseSlots['history']!,
            overflow: 'squash' as unknown as SlotOverflowStrategy,
          },
        },
      ],
      {},
    );
    expect(out[0]!.content).toHaveLength(1);
    expect(out[0]!.content[0]!.content as string).toBe('b');
  });

  it('runHook beforeBudgetResolve chains plugins in order with error isolation', async () => {
    const m = manager();
    await m.register({
      name: 'a',
      version: '1.0.0',
      beforeBudgetResolve: () => {
        throw new Error('bad');
      },
    });
    await m.register({
      name: 'b',
      version: '1.0.0',
      beforeBudgetResolve: (slots) =>
        slots.map((s) => ({ ...s, priority: s.priority + 1 })),
    });
    const slots = await m.runHook('beforeBudgetResolve', baseSlots);
    expect(slots['history']!.priority).toBe(51);
  });

  it('runHook beforeSnapshot chains transforms', async () => {
    const m = manager();
    await m.register({
      name: 't',
      version: '1.0.0',
      beforeSnapshot: (msgs) => [...msgs, { role: 'user', content: 'tail' } as CompiledMessage],
    });
    const base: CompiledMessage[] = [{ role: 'system', content: 's' }];
    const out = await m.runHook('beforeSnapshot', base);
    expect(out).toHaveLength(2);
    expect(out[1]!.content).toBe('tail');
  });

  it('runHook onEvent invokes handlers', async () => {
    const m = manager();
    const spy = vi.fn();
    await m.register({
      name: 'e',
      version: '1.0.0',
      onEvent: spy,
    });
    await m.runHook('onEvent', {
      type: 'build:start',
      totalBudget: 10,
    });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'build:start' }));
  });

  it('runHook afterBudgetResolve runs in registration order', async () => {
    const m = manager();
    const order: string[] = [];
    await m.register({
      name: '1',
      version: '1.0.0',
      afterBudgetResolve: () => {
        order.push('1');
      },
    });
    await m.register({
      name: '2',
      version: '1.0.0',
      afterBudgetResolve: () => {
        order.push('2');
      },
    });
    const resolved: ResolvedSlot[] = [
      {
        name: 'history',
        priority: 50,
        budgetTokens: 100,
        content: [],
      },
    ];
    await m.runHook('afterBudgetResolve', resolved);
    expect(order).toEqual(['1', '2']);
  });
});
