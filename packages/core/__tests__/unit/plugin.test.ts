import { describe, expect, it } from 'vitest';

import { createContentId, toTokenCount } from '../../src/types/branded.js';
import type { SlotConfig } from '../../src/types/config.js';
import type { ContentItem, CompiledMessage } from '../../src/types/content.js';
import type {
  ContextPlugin,
  PluginContext,
  ResolvedSlot,
  TokenCountCache,
  CompressionStrategy,
  PluginLogger,
} from '../../src/types/plugin.js';

describe('ResolvedSlot', () => {
  it('accepts resolved slot with content', () => {
    const item: ContentItem = {
      id: createContentId(),
      role: 'user',
      content: 'Hello',
      slot: 'history',
      createdAt: Date.now(),
    };
    const slot: ResolvedSlot = {
      name: 'history',
      priority: 50,
      budgetTokens: 5000,
      content: [item],
    };
    expect(slot.name).toBe('history');
    expect(slot.content).toHaveLength(1);
  });
});

describe('TokenCountCache', () => {
  it('accepts cache with count method', () => {
    const cache: TokenCountCache = {
      count: (content) => toTokenCount(Math.ceil(content.length / 4)),
    };
    expect(cache.count('hello')).toBe(2);
  });
});

describe('CompressionStrategy', () => {
  it('accepts compression strategy with name and CompressionContext', () => {
    const strategy: CompressionStrategy = {
      name: 'test-compress',
      compress: (items, budget, ctx) => {
        expect(ctx.slotName).toBe('history');
        expect(ctx.tokenCounter).toBeDefined();
        expect(ctx.logger).toBeDefined();
        void budget;
        return items.slice(0, 5);
      },
    };
    const items: ContentItem[] = [];
    const result = strategy.compress(items, toTokenCount(100), {
      slotName: 'history',
      slotConfig: undefined,
      config: undefined,
      tokenCounter: { count: () => toTokenCount(0) },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      anchorText: undefined,
    });
    expect(result).toHaveLength(0);
  });
});

describe('PluginLogger', () => {
  it('accepts logger with required methods', () => {
    const logger: PluginLogger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    expect(logger.debug).toBeDefined();
    expect(logger.info).toBeDefined();
    expect(logger.warn).toBeDefined();
    expect(logger.error).toBeDefined();
  });
});

describe('PluginContext', () => {
  it('accepts plugin context-shaped object', () => {
    const ctx: PluginContext = {
      getSlots: () => ({}),
      tokenCounter: { count: () => toTokenCount(0) },
      registerOverflowStrategy: () => {},
      registerCompressor: () => {},
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    };
    expect(ctx.getSlots()).toEqual({});
  });
});

describe('ContextPlugin', () => {
  it('accepts minimal plugin with name and version', () => {
    const plugin: ContextPlugin = {
      name: 'test-plugin',
      version: '1.0.0',
    };
    expect(plugin.name).toBe('test-plugin');
    expect(plugin.version).toBe('1.0.0');
  });

  it('accepts plugin with install hook', () => {
    const plugin: ContextPlugin = {
      name: 'test',
      version: '1.0.0',
      install: (ctx) => {
        expect(ctx.getSlots).toBeDefined();
        expect(ctx.tokenCounter).toBeDefined();
      },
    };
    expect(plugin.install).toBeDefined();
  });

  it('accepts plugin with all lifecycle hooks', () => {
    const plugin: ContextPlugin = {
      name: 'full',
      version: '1.0.0',
      install: () => {},
      beforeBudgetResolve: (slots: SlotConfig[]) => slots,
      afterBudgetResolve: () => {},
      beforeOverflow: (_slot, items) => items,
      afterOverflow: () => {},
      beforeSnapshot: (messages: CompiledMessage[]) => messages,
      afterSnapshot: () => {},
      onContentAdded: () => {},
      onEvent: () => {},
      destroy: () => {},
    };
    expect(plugin.beforeBudgetResolve).toBeDefined();
    expect(plugin.afterSnapshot).toBeDefined();
  });
});
