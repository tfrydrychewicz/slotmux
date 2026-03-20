import { describe, expect, it, vi } from 'vitest';

import {
  OverflowEngine,
  createContentItem,
  toTokenCount,
  ContextOverflowError,
  InvalidConfigError,
  type OverflowEngineInputSlot,
} from '../../src/index.js';
import type { SlotConfig } from '../../src/types/config.js';
import type { ContentItem } from '../../src/types/content.js';

function slot(
  name: string,
  priority: number,
  budgetTokens: number,
  config: SlotConfig,
  content: ReturnType<typeof createContentItem>[],
): OverflowEngineInputSlot {
  return {
    name,
    priority,
    budgetTokens,
    config,
    content,
  };
}

function countSum(items: readonly ContentItem[]): number {
  return items.reduce((s, i) => s + (i.tokens ?? 0), 0);
}

describe('OverflowEngine (§7.2 — Phase 4.1)', () => {
  it('leaves slots unchanged when under budget', async () => {
    const a = createContentItem({
      slot: 'a',
      role: 'user',
      content: 'x',
      tokens: toTokenCount(10),
    });
    const engine = new OverflowEngine({ countTokens: countSum });
    const out = await engine.resolve([
      slot('low', 10, 100, { priority: 10, budget: { flex: true } }, [a]),
    ]);
    expect(out[0]!.content).toHaveLength(1);
    expect(out[0]!.content[0]!.id).toBe(a.id);
  });

  it('sorts by ascending priority before processing (lowest first)', async () => {
    const order: string[] = [];
    const mk = (name: string, p: number, t: number) =>
      createContentItem({
        slot: name,
        role: 'user',
        content: 'x',
        tokens: toTokenCount(t),
      });

    const engine = new OverflowEngine({
      countTokens: countSum,
      strategies: {
        truncate: async (items) => {
          order.push(items[0]?.slot ?? '?');
          return items.slice(-1);
        },
      },
    });

    const cfg: SlotConfig = { priority: 50, budget: { flex: true } };
    await engine.resolve([
      slot('high', 90, 5, cfg, [mk('high', 90, 20)]),
      slot('low', 10, 5, cfg, [mk('low', 10, 20)]),
    ]);

    expect(order).toEqual(['low', 'high']);
  });

  it('truncates FIFO and preserves pinned items', async () => {
    const u1 = createContentItem({
      slot: 's',
      role: 'user',
      content: '1',
      tokens: toTokenCount(50),
    });
    const u2 = createContentItem({
      slot: 's',
      role: 'user',
      content: '2',
      tokens: toTokenCount(50),
    });
    const pin = createContentItem({
      slot: 's',
      role: 'user',
      content: 'p',
      pinned: true,
      tokens: toTokenCount(50),
    });

    const engine = new OverflowEngine({ countTokens: countSum });
    const out = await engine.resolve([
      slot(
        's',
        50,
        100,
        { priority: 50, budget: { flex: true }, overflow: 'truncate' },
        [u1, u2, pin],
      ),
    ]);

    expect(out[0]!.content.map((i) => i.id)).toEqual([u2.id, pin.id]);
  });

  it('emits warning and skips eviction for protected slots over budget', async () => {
    const events: { type: string }[] = [];
    const item = createContentItem({
      slot: 'p',
      role: 'system',
      content: 'big',
      tokens: toTokenCount(500),
    });

    const engine = new OverflowEngine({
      countTokens: countSum,
      onEvent: (e) => events.push({ type: e.type }),
    });

    const out = await engine.resolve([
      slot(
        'p',
        50,
        100,
        {
          priority: 50,
          budget: { flex: true },
          overflow: 'truncate',
          protected: true,
        },
        [item],
      ),
    ]);

    expect(out[0]!.content).toHaveLength(1);
    expect(events.some((e) => e.type === 'warning')).toBe(true);
    expect(events.some((e) => e.type === 'content:evicted')).toBe(false);
  });

  it('emits slot:overflow and content:evicted when truncating', async () => {
    const ev: { type: string; slot?: string; strategy?: string }[] = [];
    const i1 = createContentItem({
      slot: 'h',
      role: 'user',
      content: 'a',
      tokens: toTokenCount(40),
    });
    const i2 = createContentItem({
      slot: 'h',
      role: 'user',
      content: 'b',
      tokens: toTokenCount(40),
    });

    const engine = new OverflowEngine({
      countTokens: countSum,
      onEvent: (e) => {
        if (e.type === 'slot:overflow') {
          ev.push({
            type: e.type,
            slot: e.slot,
            strategy: e.strategy,
          });
        }
        if (e.type === 'content:evicted') {
          ev.push({ type: e.type, slot: e.slot });
        }
      },
    });

    await engine.resolve([
      slot(
        'h',
        50,
        50,
        { priority: 50, budget: { flex: true }, overflow: 'truncate' },
        [i1, i2],
      ),
    ]);

    expect(ev.some((x) => x.type === 'slot:overflow' && x.strategy === 'truncate')).toBe(
      true,
    );
    expect(ev.filter((x) => x.type === 'content:evicted')).toHaveLength(1);
  });

  it('throws ContextOverflowError for overflow: error when over budget', async () => {
    const item = createContentItem({
      slot: 'e',
      role: 'user',
      content: 'x',
      tokens: toTokenCount(100),
    });
    const engine = new OverflowEngine({ countTokens: countSum });

    await expect(
      engine.resolve([
        slot(
          'e',
          50,
          50,
          { priority: 50, budget: { flex: true }, overflow: 'error' },
          [item],
        ),
      ]),
    ).rejects.toThrow(ContextOverflowError);
  });

  it('applies compress using overflowConfig.losslessLocale', async () => {
    const countByCharLen = (items: readonly ContentItem[]): number =>
      items.reduce(
        (s, i) => s + (typeof i.content === 'string' ? i.content.length : 0),
        0,
      );

    const item = createContentItem({
      slot: 's',
      role: 'user',
      content: 'Naja, zum Beispiel kurz.',
      tokens: toTokenCount(100),
    });

    const engine = new OverflowEngine({ countTokens: countByCharLen });
    const out = await engine.resolve([
      slot(
        's',
        50,
        12,
        {
          priority: 50,
          budget: { flex: true },
          overflow: 'compress',
          overflowConfig: { losslessLocale: 'de' },
        },
        [item],
      ),
    ]);

    expect(out[0]!.content[0]!.content).toBe('z. B. kurz.');
    expect(countByCharLen(out[0]!.content)).toBeLessThanOrEqual(12);
  });

  it('applies built-in compress strategy (lossless text)', async () => {
    const countByCharLen = (items: readonly ContentItem[]): number =>
      items.reduce(
        (s, i) => s + (typeof i.content === 'string' ? i.content.length : 0),
        0,
      );

    const item = createContentItem({
      slot: 's',
      role: 'user',
      content: 'Well,   you know, for example   hello.',
      tokens: toTokenCount(100),
    });

    const engine = new OverflowEngine({ countTokens: countByCharLen });
    const out = await engine.resolve([
      slot(
        's',
        50,
        20,
        { priority: 50, budget: { flex: true }, overflow: 'compress' },
        [item],
      ),
    ]);

    expect(out[0]!.content).toHaveLength(1);
    expect(out[0]!.content[0]!.content).toBe('e.g. hello.');
    expect(countByCharLen(out[0]!.content)).toBeLessThanOrEqual(20);
  });

  it('throws InvalidConfigError for summarize when progressiveSummarize is not configured', async () => {
    const item = createContentItem({
      slot: 's',
      role: 'user',
      content: 'x',
      tokens: toTokenCount(100),
    });
    const engine = new OverflowEngine({ countTokens: countSum });

    await expect(
      engine.resolve([
        slot(
          's',
          50,
          50,
          { priority: 50, budget: { flex: true }, overflow: 'summarize' },
          [item],
        ),
      ]),
    ).rejects.toThrow(InvalidConfigError);
  });

  it('applies progressive summarize when progressiveSummarize is set', async () => {
    const mk = (content: string, t: number, at: number) =>
      createContentItem({
        slot: 's',
        role: 'user',
        content,
        tokens: toTokenCount(t),
        createdAt: at,
      });

    const items = [
      mk('old-a', 30, 1000),
      mk('old-b', 30, 2000),
      mk('mid-a', 30, 3000),
      mk('mid-b', 30, 4000),
      mk('recent-a', 30, 5000),
      mk('recent-b', 30, 6000),
    ];

    const layers: number[] = [];
    const engine = new OverflowEngine({
      countTokens: countSum,
      progressiveSummarize: {
        summarizeText: async ({ layer }) => {
          layers.push(layer);
          if (layer === 2) return 'L2';
          if (layer === 1) return 'L1';
          return 'L3';
        },
      },
    });

    const out = await engine.resolve([
      slot(
        's',
        50,
        50,
        {
          priority: 50,
          budget: { flex: true },
          overflow: 'summarize',
          overflowConfig: { preserveLastN: 2, summarizer: 'builtin:progressive' },
        },
        items,
      ),
    ]);

    expect(countSum(out[0]!.content)).toBeLessThanOrEqual(50);
    expect(layers).toContain(2);
    expect(layers).toContain(1);
    expect(layers).toContain(3);
    expect(out[0]!.content.some((i) => i.summarizes !== undefined && i.summarizes.length > 0)).toBe(
      true,
    );
  });

  it('delegates to overflowConfig.summarizer function when set', async () => {
    const item = createContentItem({
      slot: 's',
      role: 'user',
      content: 'x',
      tokens: toTokenCount(100),
    });
    const custom = vi.fn(async (items: typeof item[]) => [
      { ...items[0]!, content: 'short', tokens: toTokenCount(20) },
    ]);

    const engine = new OverflowEngine({
      countTokens: countSum,
      progressiveSummarize: {
        summarizeText: async () => 'should-not-run',
      },
    });

    await engine.resolve([
      slot(
        's',
        50,
        50,
        {
          priority: 50,
          budget: { flex: true },
          overflow: 'summarize',
          overflowConfig: { summarizer: custom },
        },
        [item],
      ),
    ]);

    expect(custom).toHaveBeenCalled();
  });

  it('throws for builtin:map-reduce when progressiveSummarize is set', async () => {
    const item = createContentItem({
      slot: 's',
      role: 'user',
      content: 'x',
      tokens: toTokenCount(100),
    });
    const engine = new OverflowEngine({
      countTokens: countSum,
      progressiveSummarize: {
        summarizeText: async () => 'x',
      },
    });

    await expect(
      engine.resolve([
        slot(
          's',
          50,
          50,
          {
            priority: 50,
            budget: { flex: true },
            overflow: 'summarize',
            overflowConfig: { summarizer: 'builtin:map-reduce' },
          },
          [item],
        ),
      ]),
    ).rejects.toThrow(InvalidConfigError);
  });

  it('invokes custom overflow function with strategy label custom', async () => {
    const seen: string[] = [];
    const item = createContentItem({
      slot: 'c',
      role: 'user',
      content: 'x',
      tokens: toTokenCount(50),
    });

    const engine = new OverflowEngine({
      countTokens: countSum,
      onEvent: (e) => {
        if (e.type === 'slot:overflow') seen.push(e.strategy);
      },
    });

    const custom = vi.fn(async (items: typeof item[]) => items.slice(0, 1));

    await engine.resolve([
      slot(
        'c',
        50,
        10,
        { priority: 50, budget: { flex: true }, overflow: custom },
        [item],
      ),
    ]);

    expect(custom).toHaveBeenCalled();
    expect(seen).toContain('custom');
  });

  it('escalates by fully evicting lowest-priority non-protected slot when totalBudget exceeded', async () => {
    const lowItem = createContentItem({
      slot: 'low',
      role: 'user',
      content: 'L',
      tokens: toTokenCount(80),
    });
    const highItem = createContentItem({
      slot: 'high',
      role: 'user',
      content: 'H',
      tokens: toTokenCount(80),
    });

    const flex: SlotConfig = { priority: 50, budget: { flex: true } };

    const engine = new OverflowEngine({ countTokens: countSum });
    const out = await engine.resolve(
      [
        slot('high', 80, 100, flex, [highItem]),
        slot('low', 20, 100, flex, [lowItem]),
      ],
      { totalBudget: 80 },
    );

    const low = out.find((s) => s.name === 'low')!;
    const high = out.find((s) => s.name === 'high')!;
    expect(low.content).toHaveLength(0);
    expect(high.content).toHaveLength(1);
    expect(countSum(high.content)).toBeLessThanOrEqual(100);
  });

  it('multiple rounds converge when global budget is tight', async () => {
    const mk = (slot: string, t: number) =>
      createContentItem({
        slot,
        role: 'user',
        content: 'x',
        tokens: toTokenCount(t),
      });

    const flex: SlotConfig = {
      priority: 50,
      budget: { flex: true },
      overflow: 'truncate',
    };

    const engine = new OverflowEngine({ countTokens: countSum });
    const out = await engine.resolve(
      [
        slot('a', 30, 50, flex, [mk('a', 40), mk('a', 40)]),
        slot('b', 70, 50, flex, [mk('b', 40), mk('b', 40)]),
      ],
      { totalBudget: 50 },
    );

    expect(countSum([...out[0]!.content, ...out[1]!.content])).toBeLessThanOrEqual(
      50,
    );
  });
});
