import { describe, expect, it, vi } from 'vitest';

import {
  InvalidConfigError,
  SlotManager,
  SlotNotFoundError,
  validateSlotConfig,
} from '../../src/index.js';

const validHistory = {
  priority: 50,
  budget: { flex: true },
} as const;

const validSystem = {
  priority: 100,
  budget: { fixed: 1024 },
} as const;

describe('validateSlotConfig', () => {
  it('accepts a valid slot', () => {
    expect(validateSlotConfig(validHistory)).toMatchObject(validHistory);
  });

  it('throws InvalidConfigError for invalid priority', () => {
    expect(() =>
      validateSlotConfig({ priority: 0, budget: { flex: true } }),
    ).toThrow(InvalidConfigError);
  });
});

describe('SlotManager', () => {
  it('registerSlot + getSlot returns a copy', () => {
    const m = new SlotManager();
    m.registerSlot('history', validHistory);
    const g = m.getSlot('history');
    expect(g).toMatchObject(validHistory);
    g!.priority = 1;
    expect(m.getSlot('history')!.priority).toBe(50);
  });

  it('registerSlot throws if slot exists', () => {
    const m = new SlotManager();
    m.registerSlot('history', validHistory);
    expect(() => m.registerSlot('history', validSystem)).toThrow(
      InvalidConfigError,
    );
  });

  it('registerSlot validates config', () => {
    const m = new SlotManager();
    expect(() =>
      m.registerSlot('bad', { priority: 50, budget: { flex: true, extra: 1 } }),
    ).toThrow(InvalidConfigError);
  });

  it('rejects empty slot name', () => {
    const m = new SlotManager();
    expect(() => m.registerSlot('', validHistory)).toThrow(InvalidConfigError);
    expect(() => m.registerSlot('   ', validHistory)).toThrow(
      InvalidConfigError,
    );
  });

  it('getSlot returns undefined for unknown slot', () => {
    const m = new SlotManager();
    expect(m.getSlot('missing')).toBeUndefined();
  });

  it('listSlots sorts by priority descending then name', () => {
    const m = new SlotManager();
    m.registerSlot('a', { priority: 10, budget: { flex: true } });
    m.registerSlot('b', { priority: 50, budget: { flex: true } });
    m.registerSlot('c', { priority: 50, budget: { fixed: 1 } });
    const names = m.listSlots().map((s) => s.name);
    expect(names).toEqual(['b', 'c', 'a']);
  });

  it('updateSlot merges and re-validates', () => {
    const m = new SlotManager();
    m.registerSlot('history', validHistory);
    m.updateSlot('history', { maxItems: 10 });
    expect(m.getSlot('history')).toMatchObject({
      ...validHistory,
      maxItems: 10,
    });
  });

  it('updateSlot throws SlotNotFoundError when missing', () => {
    const m = new SlotManager();
    expect(() =>
      m.updateSlot('nope', { maxItems: 1 }),
    ).toThrow(SlotNotFoundError);
  });

  it('updateSlot throws InvalidConfigError when merge is invalid', () => {
    const m = new SlotManager();
    m.registerSlot('history', validHistory);
    expect(() =>
      m.updateSlot('history', { priority: 0 }),
    ).toThrow(InvalidConfigError);
  });

  it('removeSlot deletes slot', () => {
    const m = new SlotManager();
    m.registerSlot('history', validHistory);
    m.removeSlot('history');
    expect(m.getSlot('history')).toBeUndefined();
    expect(m.size).toBe(0);
  });

  it('removeSlot throws SlotNotFoundError when missing', () => {
    const m = new SlotManager();
    expect(() => m.removeSlot('nope')).toThrow(SlotNotFoundError);
  });

  it('removeSlot invokes onSlotRemoved (cascade hook)', () => {
    const onSlotRemoved = vi.fn();
    const m = new SlotManager({ onSlotRemoved });
    m.registerSlot('history', validHistory);
    m.removeSlot('history');
    expect(onSlotRemoved).toHaveBeenCalledWith('history');
  });

  it('toConfigRecord builds Record for ContentStore', () => {
    const m = new SlotManager();
    m.registerSlot('history', validHistory);
    m.registerSlot('system', validSystem);
    const rec = m.toConfigRecord();
    expect(Object.keys(rec).sort()).toEqual(['history', 'system']);
    expect(rec['history']).toMatchObject(validHistory);
    rec['history']!.priority = 1;
    expect(m.getSlot('history')!.priority).toBe(50);
  });
});
