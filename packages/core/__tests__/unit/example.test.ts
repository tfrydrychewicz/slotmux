import { describe, it, expect } from 'vitest';

import { VERSION } from '../../src/index';
import { makeSlot, makeItem, makeContext } from '../helpers';

describe('slotmux', () => {
  it('exports version', () => {
    expect(VERSION).toBe('0.0.1');
  });
});

describe('makeSlot', () => {
  it('creates a slot with name, priority, budget, and items', () => {
    const item = makeItem('a', 50);
    const slot = makeSlot('history', 50, 100, [item]);

    expect(slot.name).toBe('history');
    expect(slot.priority).toBe(50);
    expect(slot.budgetTokens).toBe(100);
    expect(slot.content).toHaveLength(1);
    expect(slot.content[0]?.id).toBe('a');
    expect(slot.content[0]?.tokens).toBe(50);
  });
});

describe('makeItem', () => {
  it('creates an item with id and tokens', () => {
    const item = makeItem('x', 42);
    expect(item.id).toBe('x');
    expect(item.tokens).toBe(42);
    expect(item.role).toBe('user');
  });

  it('supports pinned option', () => {
    const item = makeItem('pinned', 10, { pinned: true });
    expect(item.pinned).toBe(true);
  });
});

describe('makeContext', () => {
  it('creates a context stub with user, system, assistant, build', () => {
    const ctx = makeContext();
    ctx.system('You are helpful.');
    ctx.user('Hello');
    ctx.assistant('Hi there!');

    const snapshot = ctx.build();
    expect(snapshot.messages).toHaveLength(3);
    expect(snapshot.meta.totalTokens).toBe(0);
  });
});
