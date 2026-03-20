import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearRegisteredModels,
  createContext,
  inferProviderFromModelId,
  MODEL_REGISTRY,
  registerModel,
  resolveModel,
  SlotOverflow,
} from '../../src/index.js';
import type { ContextPlugin } from '../../src/types/plugin.js';

describe('createContext Phase 5.3 (registry, peers, plugins)', () => {
  afterEach(() => {
    clearRegisteredModels();
  });

  it('infers maxTokens and provider from MODEL_REGISTRY for gpt-4o', () => {
    const { config, modelMatch } = createContext({
      model: 'gpt-4o',
      preset: 'chat',
    });
    expect(config.maxTokens).toBe(128_000);
    expect(config.provider?.provider).toBe('openai');
    expect(config.tokenizer?.name).toBe('o200k_base');
    expect(modelMatch).toMatchObject({ provider: 'openai', maxTokens: 128_000 });
  });

  it('does not override explicit maxTokens or provider', () => {
    const { config } = createContext({
      model: 'gpt-4o',
      preset: 'chat',
      maxTokens: 4096,
      provider: { provider: 'custom' },
    });
    expect(config.maxTokens).toBe(4096);
    expect(config.provider?.provider).toBe('custom');
  });

  it('uses inferProviderFromModelId for unknown model ids', () => {
    const { config, modelMatch } = createContext({
      model: 'my-vendor-gpt-custom',
      slots: {
        s: { priority: 10, budget: { flex: true } },
      },
    });
    expect(modelMatch).toBeUndefined();
    expect(config.provider?.provider).toBe('openai');
  });

  it('registerModel adds entries for resolveModel and createContext', () => {
    registerModel('my-embed-model', {
      maxTokens: 8192,
      provider: 'custom',
      tokenizerName: 'cl100k_base',
    });
    expect(resolveModel('my-embed-model')?.maxTokens).toBe(8192);
    const { config, modelMatch } = createContext({
      model: 'my-embed-model',
      slots: { a: { priority: 1, budget: { flex: true } } },
    });
    expect(modelMatch?.provider).toBe('custom');
    expect(config.tokenizer?.name).toBe('cl100k_base');
  });

  it('applies prepareSlots on plugins before validation', () => {
    const plugin: ContextPlugin = {
      name: 'slot-inject',
      version: '1.0.0',
      prepareSlots: (slots) => ({
        ...slots,
        customInjected: {
          priority: 1,
          budget: { flex: true },
          overflow: SlotOverflow.TRUNCATE,
        },
      }),
    };
    const { config } = createContext({
      model: 'gpt-4o',
      preset: 'chat',
      plugins: [plugin],
    });
    expect(config.slots?.['customInjected']).toMatchObject({
      priority: 1,
      overflow: SlotOverflow.TRUNCATE,
    });
  });

  it('returns plugins array from config', () => {
    const plugin = {
      name: 'p',
      version: '1.0.0',
      onEvent: vi.fn(),
    };
    const { plugins } = createContext({
      model: 'gpt-4o',
      preset: 'chat',
      plugins: [plugin],
    });
    expect(plugins).toHaveLength(1);
    // Parsed config may clone plugin objects; compare shape + shared handler.
    expect(plugins[0]).toStrictEqual(plugin);
  });

});

describe('inferProviderFromModelId', () => {
  it('maps substring patterns', () => {
    expect(inferProviderFromModelId('claude-3-opus')).toBe('anthropic');
    expect(inferProviderFromModelId('gemini-pro')).toBe('google');
    expect(inferProviderFromModelId('mistral-small')).toBe('mistral');
  });
});

describe('MODEL_REGISTRY', () => {
  it('exposes frozen built-in keys', () => {
    expect(MODEL_REGISTRY['gpt-4o']?.provider).toBe('openai');
  });

  it('includes flagship rows for OpenAI, Anthropic, and Google', () => {
    expect(MODEL_REGISTRY['gpt-5.4']?.maxTokens).toBe(1_000_000);
    expect(MODEL_REGISTRY['claude-sonnet-4-6-20260217']?.maxTokens).toBe(1_000_000);
    expect(MODEL_REGISTRY['gemini-3.1-pro-preview']?.maxTokens).toBe(1_048_576);
  });
});

describe('resolveModel', () => {
  it('prefix-matches gpt-5.* to the GPT-5.4 family', () => {
    expect(resolveModel('gpt-5.4-thinking')?.maxTokens).toBe(1_000_000);
  });
});
