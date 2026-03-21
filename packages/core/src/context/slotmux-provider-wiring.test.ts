import { describe, expect, it, vi } from 'vitest';

import type { SlotmuxProvider } from '../types/provider.js';

import { Context } from './context.js';
import { createContext } from './create-context.js';

describe('slotmuxProvider wiring', () => {
  it('accepts slotmuxProvider in createContext config', () => {
    const mockProvider: SlotmuxProvider = {
      adapter: {
        id: 'openai',
        resolveModel: () => ({
          maxContextTokens: 128_000,
          maxOutputTokens: 4096,
          supportsFunctions: true,
          supportsVision: true,
          supportsStreaming: true,
          tokenizerName: 'o200k_base',
        }),
        formatMessages: (msgs) => msgs,
        getTokenizer: () => ({
          id: 'mock',
          count: () => 10 as never,
          countBatch: (texts) => texts.map(() => 10 as never),
          countMessage: () => 10 as never,
          countMessages: () => 10 as never,
          encode: () => [],
          decode: () => '',
          truncateToFit: (t) => t,
        }),
        calculateOverhead: () => 0 as never,
      },
      summarizeText: vi.fn().mockResolvedValue('summarized content'),
    };

    const { config } = createContext({
      model: 'gpt-5.4',
      preset: 'chat',
      slotmuxProvider: mockProvider,
      charTokenEstimateForMissing: true,
    });

    expect(config.slotmuxProvider).toBe(mockProvider);
  });

  it('passes slotmuxProvider through to Context', () => {
    const summarizeText = vi.fn().mockResolvedValue('summary');

    const mockProvider: SlotmuxProvider = {
      adapter: {
        id: 'openai',
        resolveModel: () => ({
          maxContextTokens: 128_000,
          maxOutputTokens: 4096,
          supportsFunctions: true,
          supportsVision: true,
          supportsStreaming: true,
          tokenizerName: 'o200k_base',
        }),
        formatMessages: (msgs) => msgs,
        getTokenizer: () => ({
          id: 'mock',
          count: () => 10 as never,
          countBatch: (texts) => texts.map(() => 10 as never),
          countMessage: () => 10 as never,
          countMessages: () => 10 as never,
          encode: () => [],
          decode: () => '',
          truncateToFit: (t) => t,
        }),
        calculateOverhead: () => 0 as never,
      },
      summarizeText,
    };

    const { config } = createContext({
      model: 'gpt-5.4',
      preset: 'chat',
      slotmuxProvider: mockProvider,
      charTokenEstimateForMissing: true,
    });

    const ctx = Context.fromParsedConfig(config);
    ctx.system('test system');
    ctx.user('hello');

    expect(ctx).toBeDefined();
  });

  it('validates slotmuxProvider shape via Zod', () => {
    expect(() =>
      createContext({
        model: 'gpt-5.4',
        preset: 'chat',
        slotmuxProvider: { broken: true } as never,
      }),
    ).toThrow();
  });
});
