import { describe, expect, it, vi } from 'vitest';

import {
  CHAT_DEFAULTS,
  Context,
  createContext,
  InvalidConfigError,
  type ContextEvent,
  type ParsedContextConfig,
} from '../../src/index.js';

describe('Context (Phase 5.1 — §6.1, §6.3)', () => {
  it('throws when slots record is empty', () => {
    expect(
      () =>
        new Context({
          slots: {},
        }),
    ).toThrow(InvalidConfigError);
  });

  it('system, user, assistant target default system and history slots', () => {
    const ctx = new Context({ slots: { ...CHAT_DEFAULTS } });
    ctx.system('You are helpful');
    ctx.user('Hi');
    ctx.assistant('Hello');

    expect(ctx.getItems('system').map((i) => [i.role, i.content])).toEqual([
      ['system', 'You are helpful'],
    ]);
    expect(ctx.getItems('history').map((i) => [i.role, i.content])).toEqual([
      ['user', 'Hi'],
      ['assistant', 'Hello'],
    ]);
  });

  it('respects systemSlotName and historySlotName overrides', () => {
    const ctx = new Context({
      slots: {
        sys: { priority: 100, budget: { fixed: 100 }, defaultRole: 'system' },
        hist: { priority: 50, budget: { flex: true }, defaultRole: 'user' },
      },
      systemSlotName: 'sys',
      historySlotName: 'hist',
    });
    ctx.system('s');
    ctx.user('u');
    expect(ctx.getItems('sys')).toHaveLength(1);
    expect(ctx.getItems('hist')).toHaveLength(1);
  });

  it('push uses SlotConfig.defaultRole for string content', () => {
    const ctx = new Context({
      slots: {
        docs: {
          priority: 80,
          budget: { flex: true },
          defaultRole: 'assistant',
        },
      },
    });
    ctx.push('docs', 'summary text');
    expect(ctx.getItems('docs')[0]!.role).toBe('assistant');
  });

  it('push accepts multimodal blocks as a single message', () => {
    const ctx = new Context({ slots: { ...CHAT_DEFAULTS } });
    ctx.push('history', [{ type: 'text', text: 'see image' }]);
    const [item] = ctx.getItems('history');
    expect(item!.role).toBe('user');
    expect(Array.isArray(item!.content)).toBe(true);
    expect(item!.content).toEqual([{ type: 'text', text: 'see image' }]);
  });

  it('push(slot, rows[]) batch inserts with per-row metadata', () => {
    const events: ContextEvent[] = [];
    const c = new Context({
      slots: { ...CHAT_DEFAULTS },
      onEvent: (e) => events.push(e),
    });

    c.push('history', [
      { content: 'a', metadata: { src: 'batch' } },
      { content: 'b', role: 'assistant', pinned: true },
    ]);

    const items = c.getItems('history');
    expect(items).toHaveLength(2);
    expect(items[0]!.metadata).toEqual({ src: 'batch' });
    expect(items[1]!.role).toBe('assistant');
    expect(items[1]!.pinned).toBe(true);

    const added = events.filter((e) => e.type === 'content:added');
    expect(added).toHaveLength(2);
  });

  it('emits content:added for each single append', () => {
    const events: ContextEvent[] = [];
    const ctx = new Context({
      slots: { ...CHAT_DEFAULTS },
      onEvent: (e) => events.push(e),
    });
    ctx.user('1');
    ctx.user('2');
    expect(events.filter((e) => e.type === 'content:added')).toHaveLength(2);
  });

  it('pin marks item and emits content:pinned', () => {
    const events: ContextEvent[] = [];
    const ctx = new Context({
      slots: { ...CHAT_DEFAULTS },
      onEvent: (e) => events.push(e),
    });
    ctx.user('keep');
    const [item] = ctx.getItems('history');
    ctx.pin('history', item!);

    expect(ctx.getItems('history')[0]!.pinned).toBe(true);
    const pinnedEv = events.filter((e) => e.type === 'content:pinned');
    expect(pinnedEv).toHaveLength(1);
    expect(pinnedEv[0]!.type === 'content:pinned' && pinnedEv[0]!.item.pinned).toBe(
      true,
    );
  });

  it('pin accepts ContentId only', () => {
    const ctx = new Context({ slots: { ...CHAT_DEFAULTS } });
    ctx.user('x');
    const id = ctx.getItems('history')[0]!.id;
    ctx.pin('history', id);
    expect(ctx.getItems('history')[0]!.pinned).toBe(true);
  });

  it('ephemeral marks item via ContentStore', () => {
    const ctx = new Context({ slots: { ...CHAT_DEFAULTS } });
    ctx.user('tmp');
    const id = ctx.getItems('history')[0]!.id;
    ctx.ephemeral('history', id);
    expect(ctx.getItems('history')[0]!.ephemeral).toBe(true);
    ctx.clearEphemeral();
    expect(ctx.getItems('history')).toHaveLength(0);
  });

  it('fromParsedConfig uses slots and onEvent from createContext', () => {
    const log = vi.fn();
    const { config } = createContext({
      model: 'gpt-4o',
      preset: 'chat',
      onEvent: log,
    });
    const ctx = Context.fromParsedConfig(config);
    ctx.user('hi');
    expect(ctx.getItems('history')).toHaveLength(1);
    expect(log).toHaveBeenCalled();
    const call = log.mock.calls.find(
      (c) => c[0]?.type === 'content:added',
    )?.[0];
    expect(call?.type).toBe('content:added');
  });

  it('fromParsedConfig throws when slots missing or empty', () => {
    expect(() =>
      Context.fromParsedConfig({ model: 'x' } as ParsedContextConfig),
    ).toThrow(InvalidConfigError);
    expect(() =>
      Context.fromParsedConfig({ model: 'x', slots: {} } as ParsedContextConfig),
    ).toThrow(InvalidConfigError);
  });

  it('subscribeInspectorEvents receives push events; unsubscribe stops delivery', () => {
    const seen: ContextEvent[] = [];
    const ctx = new Context({ slots: { ...CHAT_DEFAULTS } });
    const off = ctx.subscribeInspectorEvents((e) => {
      seen.push(e);
    });
    ctx.user('u');
    off();
    ctx.assistant('a');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.type).toBe('content:added');
  });

  it('getSlotsConfig is undefined without fromParsedConfig', () => {
    const ctx = new Context({ slots: { ...CHAT_DEFAULTS } });
    expect(ctx.getSlotsConfig()).toBeUndefined();
  });

  it('getSlotsConfig returns layout from fromParsedConfig', () => {
    const { config } = createContext({ model: 'gpt-4o-mini', preset: 'chat' });
    const ctx = Context.fromParsedConfig(config);
    expect(ctx.getSlotsConfig()?.['system']).toBeDefined();
  });
});
