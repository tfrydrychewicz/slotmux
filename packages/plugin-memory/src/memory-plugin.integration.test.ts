/**
 * Phase 11.2 — memory plugin integration (in-memory store).
 *
 * @packageDocumentation
 */

import { Context, createContext, toTokenCount } from 'contextcraft';
import { describe, expect, it } from 'vitest';

import { InMemoryMemoryStore } from './in-memory-memory-store.js';
import { memoryPlugin } from './memory-plugin.js';

describe('memoryPlugin integration (InMemoryMemoryStore)', () => {
  it('injects memory slot and surfaces ranked store rows in the snapshot', async () => {
    const store = new InMemoryMemoryStore();
    await store.set({
      content: 'User prefers dark mode for the dashboard UI.',
    });
    await store.set({
      content: 'Unrelated note about ocean tides.',
    });

    const plugin = memoryPlugin({
      store,
      memoryBudget: { percent: 20 },
      retrievalStrategy: 'hybrid',
      hybridAlpha: 0.65,
    });

    const { config } = createContext({
      model: 'gpt-4o-mini',
      maxTokens: 8000,
      strictTokenizerPeers: false,
      preset: 'chat',
      plugins: [plugin],
    });

    expect(config.slots?.['memory']).toBeDefined();

    const ctx = Context.fromParsedConfig(config);
    ctx.push('history', [
      {
        content: 'Please confirm: do I prefer dark mode for the dashboard?',
        tokens: toTokenCount(20),
        role: 'user',
      },
    ]);

    const { snapshot } = await ctx.build();
    const text = JSON.stringify(snapshot.messages);
    expect(text).toContain('[memory]');
    expect(text.toLowerCase()).toContain('dark mode');
  });

  it('autoExtract persists long sentences into the store', async () => {
    const store = new InMemoryMemoryStore();
    const plugin = memoryPlugin({
      store,
      memoryBudget: { fixed: 500 },
      autoExtract: true,
      autoExtractMinLength: 20,
    });

    const { config } = createContext({
      model: 'gpt-4o-mini',
      maxTokens: 4000,
      strictTokenizerPeers: false,
      preset: 'chat',
      plugins: [plugin],
    });

    const ctx = Context.fromParsedConfig(config);
    ctx.push('history', [
      {
        content: 'Setting context.',
        tokens: toTokenCount(4),
        role: 'user',
      },
      {
        content:
          'The deployment pipeline must always run integration tests before promoting to production environments.',
        tokens: toTokenCount(40),
        role: 'assistant',
      },
    ]);

    await ctx.build();
    const all = await store.search('', { limit: 50 });
    const joined = all.map((r) => r.content).join(' ');
    expect(joined).toMatch(/deployment pipeline/i);
  });
});
