import { describe, expect, it, vi } from 'vitest';

import type { ContextPushItemInput } from '../../src/context/context.js';
import {
  CHAT_DEFAULTS,
  Context,
  ContextOrchestrator,
  toTokenCount,
  validateContextConfig,
  type ContextPlugin,
  type ParsedContextConfig,
} from '../../src/index.js';

function chatConfig(
  overrides: Partial<ParsedContextConfig> = {},
): ParsedContextConfig {
  return validateContextConfig({
    model: 'gpt-4o-mini',
    maxTokens: 12_000,
    slots: { ...CHAT_DEFAULTS },
    ...overrides,
  });
}

describe('ContextOrchestrator Phase 5.4 (pipeline & plugins)', () => {
  it('Step 1–3: beforeBudgetResolve mutates slot budgets; afterBudgetResolve runs', async () => {
    const afterBudget = vi.fn();
    const plugin: ContextPlugin = {
      name: 'budget-tweak',
      version: '1.0.0',
      beforeBudgetResolve: (configs) =>
        configs.map((c) =>
          c.priority === 100 ? { ...c, budget: { fixed: 120 } } : c,
        ),
      afterBudgetResolve: afterBudget,
    };
    const cfg = chatConfig({
      plugins: [plugin] as ParsedContextConfig['plugins'],
    });
    const ctx = Context.fromParsedConfig(cfg);
    ctx.system('x');
    ctx.user('y');

    const { snapshot } = await ContextOrchestrator.build({ config: cfg, context: ctx });

    expect(snapshot.meta.slots['system']?.budgetTokens).toBe(120);
    expect(afterBudget).toHaveBeenCalledTimes(1);
    const arg = afterBudget.mock.calls[0]![0] as { name: string; budgetTokens: number }[];
    expect(arg.some((s) => s.name === 'system' && s.budgetTokens === 120)).toBe(true);
  });

  it('Step 4: tokenAccountant drives overflow counting and snapshot totals', async () => {
    const cfg = chatConfig({
      tokenAccountant: {
        countItems: (items) => items.length * 10,
      },
    });
    const ctx = Context.fromParsedConfig(cfg);
    ctx.system('a');
    ctx.user('b');
    ctx.assistant('c');

    const { snapshot } = await ContextOrchestrator.build({ config: cfg, context: ctx });

    expect(snapshot.meta.totalTokens).toBe(30);
    expect(snapshot.meta.slots['system']?.usedTokens).toBe(10);
    expect(snapshot.meta.slots['history']?.usedTokens).toBe(20);
  });

  it('Step 5–7: beforeOverflow and afterOverflow run per slot', async () => {
    const cfg = validateContextConfig({
      model: 'm',
      maxTokens: 2000,
      slots: {
        a: {
          priority: 100,
          budget: { fixed: 40 },
          overflow: 'truncate',
          defaultRole: 'user',
          position: 'after',
        },
      },
    });
    const ctx = Context.fromParsedConfig(cfg);
    const rows: ContextPushItemInput[] = Array.from({ length: 12 }, (_, i) => ({
      content: `msg-${i}-` + 'x'.repeat(80),
      tokens: toTokenCount(120),
    }));
    ctx.push('a', rows);

    const afterOverflow = vi.fn();
    const plugin: ContextPlugin = {
      name: 'overflow-hooks',
      version: '1.0.0',
      beforeOverflow: (_slot, items) => items,
      afterOverflow,
    };

    const parsed = validateContextConfig({
      ...cfg,
      plugins: [plugin] as ParsedContextConfig['plugins'],
    });
    await ContextOrchestrator.build({
      config: parsed,
      context: ctx,
    });

    expect(afterOverflow).toHaveBeenCalled();
    const withEvictions = afterOverflow.mock.calls.filter((c) => c[2].length > 0);
    expect(withEvictions.length).toBeGreaterThan(0);
  });

  it('Step 8–11: beforeSnapshot transforms messages; afterSnapshot runs before clearEphemeral', async () => {
    const afterSnap = vi.fn();
    const plugin: ContextPlugin = {
      name: 'snap-hooks',
      version: '1.0.0',
      beforeSnapshot: (messages) => [
        ...messages,
        { role: 'user' as const, content: '[injected]' },
      ],
      afterSnapshot: afterSnap,
    };
    const cfg = chatConfig({
      plugins: [plugin] as ParsedContextConfig['plugins'],
    });
    const ctx = Context.fromParsedConfig(cfg);
    ctx.system('s');
    ctx.user('u');

    const onEvent = vi.fn();
    const cfgWithEvent = validateContextConfig({
      model: cfg.model,
      maxTokens: cfg.maxTokens,
      slots: cfg.slots,
      plugins: [plugin] as ParsedContextConfig['plugins'],
      onEvent,
    });

    const { snapshot } = await ContextOrchestrator.build({
      config: cfgWithEvent,
      context: ctx,
    });

    const last = snapshot.messages[snapshot.messages.length - 1]!;
    expect(typeof last.content === 'string' ? last.content : '').toContain('[injected]');
    expect(afterSnap).toHaveBeenCalledWith(snapshot);
    const completeIdx = onEvent.mock.calls.findIndex(
      (c) => c[0].type === 'build:complete',
    );
    expect(completeIdx).toBeGreaterThan(-1);
    expect(afterSnap.mock.invocationCallOrder[0]).toBeLessThan(
      onEvent.mock.invocationCallOrder[completeIdx]!,
    );
  });

  it('Step 13: records buildTimeMs in snapshot meta', async () => {
    const cfg = chatConfig();
    const ctx = Context.fromParsedConfig(cfg);
    ctx.user('hi');
    const { snapshot } = await ContextOrchestrator.build({ config: cfg, context: ctx });
    expect(snapshot.meta.buildTimeMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(snapshot.meta.buildTimeMs)).toBe(true);
  });

  it('throws when beforeBudgetResolve returns wrong slot count', async () => {
    const plugin: ContextPlugin = {
      name: 'bad',
      version: '1.0.0',
      beforeBudgetResolve: () => [],
    };
    const cfg = chatConfig({
      plugins: [plugin] as ParsedContextConfig['plugins'],
    });
    const ctx = Context.fromParsedConfig(cfg);
    ctx.user('x');
    await expect(
      ContextOrchestrator.build({ config: cfg, context: ctx }),
    ).rejects.toThrow(/beforeBudgetResolve must return/);
  });
});
