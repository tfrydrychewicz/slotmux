import { describe, expect, it } from 'vitest';

import {
  ContentStore,
  createContentItem,
  InvalidConfigError,
  ItemNotFoundError,
  MaxItemsExceededError,
  SlotNotFoundError,
  toContentId,
} from '../../src/index.js';
import type { SlotConfig } from '../../src/types/config.js';

const baseSlot = (): Record<string, SlotConfig> => ({
  history: { priority: 50, budget: { flex: true } },
  system: { priority: 100, budget: { fixed: 1024 } },
});

describe('createContentItem', () => {
  it('generates id and createdAt by default', () => {
    const before = Date.now();
    const item = createContentItem({
      slot: 'history',
      role: 'user',
      content: 'hello',
    });
    expect(item.id).toBeTruthy();
    expect(typeof item.id).toBe('string');
    expect(item.createdAt).toBeGreaterThanOrEqual(before);
    expect(item.slot).toBe('history');
    expect(item.role).toBe('user');
    expect(item.content).toBe('hello');
  });

  it('preserves explicit id and createdAt', () => {
    const id = toContentId('fixed-id');
    const item = createContentItem({
      slot: 's',
      role: 'assistant',
      content: 'x',
      id,
      createdAt: 42,
    });
    expect(item.id).toBe(id);
    expect(item.createdAt).toBe(42);
  });
});

describe('ContentStore', () => {
  it('exposes registeredSlots from constructor config', () => {
    const store = new ContentStore(baseSlot());
    expect(store.registeredSlots.sort()).toEqual(['history', 'system']);
  });

  it('addItem and getItems preserve insertion order', () => {
    const store = new ContentStore(baseSlot());
    const a = createContentItem({
      slot: 'history',
      role: 'user',
      content: 'a',
    });
    const b = createContentItem({
      slot: 'history',
      role: 'user',
      content: 'b',
    });
    store.addItem('history', a);
    store.addItem('history', b);
    const items = store.getItems('history');
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.content)).toEqual(['a', 'b']);
  });

  it('getItems returns copies (mutations do not affect store)', () => {
    const store = new ContentStore(baseSlot());
    const item = createContentItem({
      slot: 'history',
      role: 'user',
      content: 'x',
    });
    store.addItem('history', item);
    const [g] = store.getItems('history');
    expect(g).toBeDefined();
    g!.content = 'mutated';
    expect(store.getItems('history')[0]!.content).toBe('x');
  });

  it('throws SlotNotFoundError for unknown slot on getItems', () => {
    const store = new ContentStore(baseSlot());
    expect(() => store.getItems('unknown')).toThrow(SlotNotFoundError);
  });

  it('throws SlotNotFoundError for unknown slot on addItem', () => {
    const store = new ContentStore(baseSlot());
    const item = createContentItem({
      slot: 'nope',
      role: 'user',
      content: 'x',
    });
    expect(() => store.addItem('nope', item)).toThrow(SlotNotFoundError);
  });

  it('throws InvalidConfigError when item.slot mismatches addItem slot', () => {
    const store = new ContentStore(baseSlot());
    const item = createContentItem({
      slot: 'history',
      role: 'user',
      content: 'x',
    });
    expect(() => store.addItem('system', item)).toThrow(InvalidConfigError);
  });

  it('removeItem returns removed item and drops it from list', () => {
    const store = new ContentStore(baseSlot());
    const item = createContentItem({
      slot: 'history',
      role: 'user',
      content: 'bye',
    });
    store.addItem('history', item);
    const removed = store.removeItem('history', item.id);
    expect(removed.content).toBe('bye');
    expect(store.getItems('history')).toHaveLength(0);
  });

  it('removeItem throws ItemNotFoundError when id missing', () => {
    const store = new ContentStore(baseSlot());
    expect(() =>
      store.removeItem('history', toContentId('missing')),
    ).toThrow(ItemNotFoundError);
  });

  it('pinItem sets pinned true', () => {
    const store = new ContentStore(baseSlot());
    const item = createContentItem({
      slot: 'history',
      role: 'user',
      content: 'p',
    });
    store.addItem('history', item);
    store.pinItem('history', item.id);
    expect(store.getItems('history')[0]!.pinned).toBe(true);
  });

  it('pinItem throws ItemNotFoundError when id missing', () => {
    const store = new ContentStore(baseSlot());
    expect(() => store.pinItem('history', toContentId('x'))).toThrow(
      ItemNotFoundError,
    );
  });

  it('clearEphemeral removes only ephemeral items across slots', () => {
    const store = new ContentStore(baseSlot());
    const keep = createContentItem({
      slot: 'history',
      role: 'user',
      content: 'keep',
      ephemeral: false,
    });
    const gone = createContentItem({
      slot: 'history',
      role: 'user',
      content: 'gone',
      ephemeral: true,
    });
    const sysEphemeral = createContentItem({
      slot: 'system',
      role: 'system',
      content: 'tmp',
      ephemeral: true,
    });
    store.addItem('history', keep);
    store.addItem('history', gone);
    store.addItem('system', sysEphemeral);

    store.clearEphemeral();

    expect(store.getItems('history').map((i) => i.content)).toEqual(['keep']);
    expect(store.getItems('system')).toHaveLength(0);
  });

  it('enforces maxItems from SlotConfig', () => {
    const store = new ContentStore({
      tiny: { priority: 10, budget: { fixed: 100 }, maxItems: 2 },
    });
    const one = createContentItem({
      slot: 'tiny',
      role: 'user',
      content: '1',
    });
    const two = createContentItem({
      slot: 'tiny',
      role: 'user',
      content: '2',
    });
    const three = createContentItem({
      slot: 'tiny',
      role: 'user',
      content: '3',
    });
    store.addItem('tiny', one);
    store.addItem('tiny', two);
    expect(() => store.addItem('tiny', three)).toThrow(MaxItemsExceededError);
  });

  it('allows add after remove when at maxItems', () => {
    const store = new ContentStore({
      tiny: { priority: 10, budget: { fixed: 100 }, maxItems: 1 },
    });
    const a = createContentItem({
      slot: 'tiny',
      role: 'user',
      content: 'a',
    });
    const b = createContentItem({
      slot: 'tiny',
      role: 'user',
      content: 'b',
    });
    store.addItem('tiny', a);
    store.removeItem('tiny', a.id);
    store.addItem('tiny', b);
    expect(store.getItems('tiny')).toHaveLength(1);
    expect(store.getItems('tiny')[0]!.content).toBe('b');
  });
});
