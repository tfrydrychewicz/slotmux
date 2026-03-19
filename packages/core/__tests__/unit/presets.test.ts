import { describe, expect, it } from 'vitest';

import {
  AGENT_DEFAULTS,
  BudgetAllocator,
  CHAT_DEFAULTS,
  CONTEXT_PRESETS,
  createContext,
  InvalidConfigError,
  RAG_DEFAULTS,
  resolveContextSlots,
} from '../../src/index.js';

const LARGE_BUDGET = 100_000;

describe('presets (§7.3 — Phase 3.5)', () => {
  describe('resolveContextSlots', () => {
    it('defaults to chat layout when preset and slots are omitted', () => {
      expect(resolveContextSlots({})).toEqual(CONTEXT_PRESETS.chat);
      expect(Object.keys(resolveContextSlots({}))).toEqual([
        'system',
        'history',
      ]);
    });

    it('uses only user slots when slots are set and preset is omitted', () => {
      const custom = {
        only: {
          priority: 10 as const,
          budget: { flex: true as const },
          defaultRole: 'user' as const,
        },
      };
      expect(resolveContextSlots({ slots: custom })).toEqual(custom);
    });

    it('merges preset with slot overrides (override wins per key)', () => {
      const merged = resolveContextSlots({
        preset: 'rag',
        slots: {
          system: {
            priority: 100,
            budget: { fixed: 500 },
            defaultRole: 'system',
            position: 'before',
            overflow: 'error',
          },
        },
      });
      expect(merged.system?.budget).toEqual({ fixed: 500 });
      expect(merged.rag).toEqual(RAG_DEFAULTS.rag);
      expect(merged.history).toEqual(RAG_DEFAULTS.history);
      expect(merged.output).toEqual(RAG_DEFAULTS.output);
    });
  });

  describe('createContext', () => {
    it('validates chat preset and exposes CHAT_DEFAULTS structure', () => {
      const { config } = createContext({
        model: 'gpt-4',
        preset: 'chat',
        maxTokens: LARGE_BUDGET,
      });
      expect(config.slots?.system).toMatchObject({
        budget: { fixed: 2000 },
        defaultRole: 'system',
        overflow: 'error',
      });
      expect(config.slots?.history).toMatchObject({
        budget: { flex: true },
        overflow: 'summarize',
      });
      expect(config.slots).toEqual(
        expect.objectContaining({
          system: expect.objectContaining(CHAT_DEFAULTS.system),
          history: expect.objectContaining(CHAT_DEFAULTS.history),
        }),
      );
    });

    it('validates rag preset with system, rag, history, output', () => {
      const { config } = createContext({
        model: 'gpt-4',
        preset: 'rag',
        maxTokens: LARGE_BUDGET,
      });
      expect(Object.keys(config.slots ?? {}).sort()).toEqual([
        'history',
        'output',
        'rag',
        'system',
      ]);
      expect(config.slots?.rag?.defaultRole).toBe('user');
      expect(config.slots?.output?.defaultRole).toBe('assistant');
    });

    it('validates agent preset with tools and scratchpad', () => {
      const { config } = createContext({
        model: 'gpt-4',
        preset: 'agent',
        maxTokens: LARGE_BUDGET,
      });
      expect(Object.keys(config.slots ?? {}).sort()).toEqual([
        'history',
        'scratchpad',
        'system',
        'tools',
      ]);
      expect(config.slots?.tools?.defaultRole).toBe('tool');
      expect(config.slots?.scratchpad?.position).toBe('interleave');
    });

    it('defaults to chat when neither preset nor slots provided', () => {
      const { config } = createContext({
        model: 'gpt-4',
        maxTokens: LARGE_BUDGET,
      });
      expect(Object.keys(config.slots ?? {}).sort()).toEqual([
        'history',
        'system',
      ]);
    });

    it('throws when fixed slot sum exceeds maxTokens', () => {
      expect(() =>
        createContext({
          model: 'gpt-4',
          preset: 'chat',
          maxTokens: 1000,
        }),
      ).toThrow(InvalidConfigError);
    });
  });

  describe('BudgetAllocator with preset configs', () => {
    it('resolves chat preset without error', () => {
      const { config } = createContext({
        model: 'm',
        preset: 'chat',
        maxTokens: LARGE_BUDGET,
      });
      const r = new BudgetAllocator().resolve(config.slots!, LARGE_BUDGET);
      const byName = Object.fromEntries(r.map((s) => [s.name, s.budgetTokens]));
      expect(byName.system).toBe(2000);
      expect(byName.history).toBe(LARGE_BUDGET - 2000);
    });

    it('resolves rag preset without error', () => {
      const { config } = createContext({
        model: 'm',
        preset: 'rag',
        maxTokens: LARGE_BUDGET,
      });
      const r = new BudgetAllocator().resolve(config.slots!, LARGE_BUDGET);
      const total = r.reduce((s, x) => s + x.budgetTokens, 0);
      expect(total).toBe(LARGE_BUDGET);
      expect(r.find((s) => s.name === 'system')?.budgetTokens).toBe(2000);
    });

    it('resolves agent preset without error', () => {
      const { config } = createContext({
        model: 'm',
        preset: 'agent',
        maxTokens: LARGE_BUDGET,
      });
      const r = new BudgetAllocator().resolve(config.slots!, LARGE_BUDGET);
      const total = r.reduce((s, x) => s + x.budgetTokens, 0);
      expect(total).toBe(LARGE_BUDGET);
    });
  });
});

describe('AGENT_DEFAULTS export', () => {
  it('includes expected keys for documentation parity', () => {
    expect(Object.keys(AGENT_DEFAULTS).sort()).toEqual([
      'history',
      'scratchpad',
      'system',
      'tools',
    ]);
  });
});
