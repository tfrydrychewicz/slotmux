/**
 * RAG plugin integration (simulated pipeline).
 *
 * @packageDocumentation
 */

import { Context, createContext, toTokenCount } from 'slotmux';
import { describe, expect, it } from 'vitest';

import { RAG_METADATA_CHUNK_ID, RAG_METADATA_SCORE, ragPlugin } from './index.js';

describe('ragPlugin integration', () => {
  it('prepareSlots adds rag when missing on chat preset', () => {
    const plugin = ragPlugin();
    const { config } = createContext({
      model: 'gpt-4o-mini',
      strictTokenizerPeers: false,
      preset: 'chat',
      plugins: [plugin],
    });
    expect(config.slots?.['rag']).toBeDefined();
  });

  it('dedupes, enforces maxChunks, and records citations after build', async () => {
    const plugin = ragPlugin({
      maxChunks: 3,
      deduplication: true,
      dedupeThreshold: 0.88,
      citationTracking: true,
    });

    const { config } = createContext({
      model: 'gpt-4o-mini',
      maxTokens: 8000,
      strictTokenizerPeers: false,
      preset: 'chat',
      plugins: [plugin],
    });

    const ctx = Context.fromParsedConfig(config);
    const mk = (id: string, text: string, score: number, chunkId: string) => ({
      content: text,
      tokens: toTokenCount(20),
      metadata: {
        [RAG_METADATA_SCORE]: score,
        [RAG_METADATA_CHUNK_ID]: chunkId,
      },
    });

    ctx.push('rag', [
      mk('1', 'alpha document about rust programming language basics', 0.1, 'c1'),
      mk('2', 'alpha document about rust programming language basics', 0.2, 'c2'),
      mk('3', 'beta notes on ocean waves', 0.5, 'c3'),
      mk('4', 'gamma guide to typescript generics', 0.9, 'c4'),
      mk('5', 'delta unrelated content block here', 0.3, 'c5'),
    ]);

    await ctx.build();

    const cites = plugin.getRagCitations();
    expect(cites).toHaveLength(3);
    const ids = new Set(cites.map((c) => c.chunkId));
    expect(ids.has('c2')).toBe(false);
    expect(ids.has('c4')).toBe(true);
    expect(ids.has('c3')).toBe(true);
    expect(ids.has('c5')).toBe(true);
  });

  it('rerankOnOverflow with custom rerank orders worst-first for FIFO truncate', async () => {
    const plugin = ragPlugin({
      maxChunks: 10,
      deduplication: false,
      rerankOnOverflow: true,
      rerank: (items) => [...items].reverse(),
    });

    const { config } = createContext({
      model: 'gpt-4o-mini',
      maxTokens: 500,
      strictTokenizerPeers: false,
      slots: {
        system: {
          priority: 100,
          budget: { fixed: 50 },
          overflow: 'error',
          defaultRole: 'system',
          position: 'before',
        },
        rag: {
          priority: 80,
          budget: { fixed: 80 },
          overflow: 'truncate',
          defaultRole: 'user',
          position: 'before',
        },
        history: {
          priority: 50,
          budget: { flex: true },
          overflow: 'truncate',
          defaultRole: 'user',
          position: 'after',
        },
      },
      plugins: [plugin],
    });

    const ctx = Context.fromParsedConfig(config);
    for (let i = 0; i < 5; i++) {
      ctx.push('rag', [
        {
          content: `chunk-${i}`,
          tokens: toTokenCount(40),
          metadata: { [RAG_METADATA_CHUNK_ID]: `id-${i}` },
        },
      ]);
    }

    await ctx.build();

    const cites = plugin.getRagCitations();
    const order = cites.map((c) => c.chunkId);
    expect(order.length).toBeGreaterThan(0);
    expect(order[order.length - 1]).toBe('id-0');
  });
});
