import { describe, expect, it } from 'vitest';

import { createContentId, toTokenCount } from '../../src/types/branded.js';
import type { ContentItem } from '../../src/types/content.js';
import type { ContextEvent } from '../../src/types/events.js';
import type { ContextSnapshot, ContextWarning } from '../../src/types/snapshot.js';

function makeItem(): ContentItem {
  return {
    id: createContentId(),
    role: 'user',
    content: 'Test',
    slot: 'history',
    createdAt: Date.now(),
  };
}

function makeSnapshot(): ContextSnapshot {
  const messages = [{ role: 'user' as const, content: 'Hi' }];
  const meta = {
    totalTokens: toTokenCount(5),
    totalBudget: toTokenCount(8000),
    utilization: 0.000625,
    waste: toTokenCount(0),
    slots: {},
    compressions: [],
    evictions: [],
    warnings: [],
    buildTimeMs: 1,
    builtAt: Date.now(),
  };
  return {
    id: 'snap-1',
    messages,
    meta,
    format: () => messages,
    serialize: () => ({
      version: '1.0' as const,
      id: 'snap-1',
      model: 'gpt-4-turbo',
      slots: {},
      messages: [...messages],
      meta,
      checksum: 'x',
    }),
    diff: () => ({ added: [], removed: [], modified: [] }),
  };
}

describe('ContextEvent', () => {
  it('content:added', () => {
    const item = makeItem();
    const event: ContextEvent = { type: 'content:added', slot: 'history', item };
    expect(event.type).toBe('content:added');
    expect(event.item).toBe(item);
  });

  it('content:evicted', () => {
    const item = makeItem();
    const event: ContextEvent = {
      type: 'content:evicted',
      slot: 'history',
      item,
      reason: 'overflow',
    };
    expect(event.type).toBe('content:evicted');
    expect(event.reason).toBe('overflow');
  });

  it('content:pinned', () => {
    const item = makeItem();
    const event: ContextEvent = { type: 'content:pinned', slot: 'system', item };
    expect(event.type).toBe('content:pinned');
  });

  it('slot:overflow', () => {
    const event: ContextEvent = {
      type: 'slot:overflow',
      slot: 'history',
      strategy: 'truncate',
      beforeTokens: 6000,
      afterTokens: 4000,
    };
    expect(event.type).toBe('slot:overflow');
    expect(event.beforeTokens).toBe(6000);
    expect(event.afterTokens).toBe(4000);
  });

  it('slot:budget-resolved', () => {
    const event: ContextEvent = {
      type: 'slot:budget-resolved',
      slot: 'history',
      budgetTokens: 5000,
    };
    expect(event.type).toBe('slot:budget-resolved');
    expect(event.budgetTokens).toBe(5000);
  });

  it('compression:start', () => {
    const event: ContextEvent = {
      type: 'compression:start',
      slot: 'history',
      itemCount: 20,
    };
    expect(event.type).toBe('compression:start');
    expect(event.itemCount).toBe(20);
  });

  it('compression:complete', () => {
    const event: ContextEvent = {
      type: 'compression:complete',
      slot: 'history',
      beforeTokens: 8000,
      afterTokens: 2000,
      ratio: 0.75,
    };
    expect(event.type).toBe('compression:complete');
    expect(event.ratio).toBe(0.75);
  });

  it('build:start', () => {
    const event: ContextEvent = {
      type: 'build:start',
      totalBudget: 8000,
    };
    expect(event.type).toBe('build:start');
    expect(event.totalBudget).toBe(8000);
  });

  it('build:complete', () => {
    const snapshot = makeSnapshot();
    const event: ContextEvent = {
      type: 'build:complete',
      snapshot,
    };
    expect(event.type).toBe('build:complete');
    expect(event.snapshot).toBe(snapshot);
  });

  it('warning', () => {
    const warning: ContextWarning = {
      code: 'NEAR_OVERFLOW',
      message: 'Slot at 95%',
      slot: 'history',
      severity: 'warn',
    };
    const event: ContextEvent = { type: 'warning', warning };
    expect(event.type).toBe('warning');
    expect(event.warning.code).toBe('NEAR_OVERFLOW');
  });

  it('narrows type in switch', () => {
    const event: ContextEvent = {
      type: 'content:added',
      slot: 'history',
      item: makeItem(),
    };

    switch (event.type) {
      case 'content:added':
        expect(event.item).toBeDefined();
        expect(event.slot).toBe('history');
        break;
      default:
        expect.fail('Should not reach default');
    }
  });
});
