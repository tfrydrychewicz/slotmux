import { describe, expect, it, vi } from 'vitest';

import {
  CompressionFailedError,
  ContextOverflowError,
  createContentItem,
  createFallbackChainStrategy,
  errorStrategy,
  toTokenCount,
  truncateStrategy,
} from '../../src/index.js';
import type { OverflowContext } from '../../src/types/config.js';

describe('createFallbackChainStrategy (§15.2 — Phase 4.7)', () => {
  it('on CompressionFailedError from summarize, logs and falls through to truncate', async () => {
    const warn = vi.fn();
    const ctx: OverflowContext = {
      slot: 's',
      logger: { trace: vi.fn(), warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    const a = createContentItem({
      slot: 's',
      role: 'user',
      content: 'a',
      tokens: toTokenCount(40),
    });
    const b = createContentItem({
      slot: 's',
      role: 'user',
      content: 'b',
      tokens: toTokenCount(40),
    });

    const chain = createFallbackChainStrategy({
      summarize: async () => {
        throw new CompressionFailedError('summarize failed', {
          fallbackStrategy: 'truncate',
        });
      },
      compress: async (items) => items,
      truncate: truncateStrategy,
      error: async () => {
        throw new Error('error strategy should not run');
      },
    });

    const out = await chain([a, b], toTokenCount(50), ctx);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(b.id);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/\[fallback-chain\].*summarize/),
    );
  });

  it('invokes error after truncate when still over budget', async () => {
    const pin = createContentItem({
      slot: 's',
      role: 'user',
      content: 'p',
      pinned: true,
      tokens: toTokenCount(100),
    });
    const ctx: OverflowContext = { slot: 's' };

    const chain = createFallbackChainStrategy({
      summarize: async (items) => items,
      compress: async (items) => items,
      truncate: truncateStrategy,
      error: errorStrategy,
    });

    await expect(chain([pin], toTokenCount(50), ctx)).rejects.toThrow(
      ContextOverflowError,
    );
  });
});
