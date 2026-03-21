import { describe, expect, it } from 'vitest';

import {
  CHAT_DEFAULTS,
  Context,
  contextBuilder,
  InvalidConfigError,
  validateContextConfig,
  type SlotConfig,
} from '../../src/index.js';

describe('Context.build overrides (§6.4)', () => {
  it('throws when Context was constructed without fromParsedConfig', async () => {
    const ctx = new Context({ slots: { ...CHAT_DEFAULTS } });
    await expect(ctx.build()).rejects.toThrow(InvalidConfigError);
  });

  it('applies reserve and maxTokens overrides without mutating stored parsed config', async () => {
    const parsed = validateContextConfig({
      model: 'gpt-4o-mini',
      maxTokens: 10_000,
      reserveForResponse: 500,
      slots: { ...CHAT_DEFAULTS },
    });
    const ctx = Context.fromParsedConfig(parsed);
    ctx.user('hi');

    const reserveBefore = parsed.reserveForResponse;
    const maxBefore = parsed.maxTokens;

    const { snapshot } = await ctx.build({
      overrides: {
        reserveForResponse: 2000,
        maxTokens: 8000,
      },
    });

    expect(parsed.reserveForResponse).toBe(reserveBefore);
    expect(parsed.maxTokens).toBe(maxBefore);
    expect(Number(snapshot.meta.totalBudget)).toBe(6000);
  });

  it('applies per-slot budget override for one build; base slot config unchanged', async () => {
    const parsed = validateContextConfig({
      model: 'm',
      maxTokens: 20_000,
      slots: { ...CHAT_DEFAULTS },
    });
    const ctx = Context.fromParsedConfig(parsed);
    ctx.system('s');
    ctx.user('u');

    const slots = parsed.slots as Record<string, SlotConfig>;
    const historyBefore = { ...slots['history'] };

    const { snapshot } = await ctx.build({
      overrides: {
        slots: {
          history: { budget: { fixed: 400 } },
        },
      },
    });

    expect(slots['history']).toEqual(historyBefore);
    expect(Number(snapshot.meta.slots['history']?.budgetTokens)).toBe(400);
  });

  it('second build without overrides uses original budgets again', async () => {
    const parsed = validateContextConfig({
      model: 'm',
      maxTokens: 5000,
      reserveForResponse: 0,
      slots: {
        system: {
          priority: 100,
          budget: { fixed: 500 },
          defaultRole: 'system',
          position: 'before',
          overflow: 'error',
        },
        history: {
          priority: 50,
          budget: { flex: true },
          defaultRole: 'user',
          position: 'after',
          overflow: 'truncate',
        },
      },
    });
    const ctx = Context.fromParsedConfig(parsed);
    ctx.user('x');

    await ctx.build({
      overrides: { slots: { history: { budget: { fixed: 50 } } } },
    });
    const { snapshot } = await ctx.build();

    expect(Number(snapshot.meta.slots['history']?.budgetTokens)).not.toBe(50);
  });

  it('contextBuilder forwards build params to Context.build', async () => {
    const { snapshot } = await contextBuilder()
      .model('m')
      .preset('chat')
      .reserve(100)
      .user('hello')
      .build({
        overrides: { reserveForResponse: 2000 },
      });

    expect(Number(snapshot.meta.totalBudget)).toBeLessThan(8000);
  });

  it('forceCompress triggers overflow on within-budget slots', async () => {
    const parsed = validateContextConfig({
      model: 'gpt-4o-mini',
      maxTokens: 100_000,
      reserveForResponse: 500,
      lazyContentItemTokens: true,
      slots: {
        system: {
          priority: 100,
          budget: { fixed: 2000 },
          position: 'before',
          overflow: 'error',
          protected: true,
        },
        history: {
          priority: 50,
          budget: { flex: true },
          position: 'after',
          overflow: 'truncate',
        },
      },
    });
    const ctx = Context.fromParsedConfig(parsed);
    ctx.system('You are a helpful assistant.');
    const longMsg = 'This is a longer message to ensure meaningful character-based token estimates. '.repeat(10);
    for (let i = 0; i < 20; i++) {
      ctx.user(`${longMsg} Turn ${String(i)}`);
      ctx.assistant(`${longMsg} Reply ${String(i)}`);
    }

    const normal = await ctx.build();
    const normalCount = normal.snapshot.meta.slots['history']?.itemCount ?? 0;

    const forced = await ctx.build({ overrides: { forceCompress: true } });
    const forcedCount = forced.snapshot.meta.slots['history']?.itemCount ?? 0;

    expect(forcedCount).toBeLessThan(normalCount);
  });
});
