import { describe, expect, it, vi } from 'vitest';

import {
  compressionContextFromOverflow,
  overflowStrategyLoggerToLogger,
} from '../../src/compression/from-overflow-context.js';
import { createContentId, toTokenCount } from '../../src/types/branded.js';
import type { OverflowContext } from '../../src/types/config.js';
import type { ContentItem } from '../../src/types/content.js';

const tokenCounter = { count: (s: string) => toTokenCount(s.length) };
const fallbackLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('compressionContextFromOverflow', () => {
  it('fills slotName, config, tokenCounter, logger, anchorText from string anchorTo', () => {
    const overflow: OverflowContext = {
      slot: 'history',
      slotName: 'history',
      slotConfig: {
        priority: 50,
        budget: { fixed: 100 },
        overflowConfig: { anchorTo: 'focus on this' },
      },
    };
    const ctx = compressionContextFromOverflow(overflow, {
      tokenCounter,
      fallbackLogger,
    });
    expect(ctx.slotName).toBe('history');
    expect(ctx.config?.anchorTo).toBe('focus on this');
    expect(ctx.anchorText).toBe('focus on this');
    expect(ctx.tokenCounter).toBe(tokenCounter);
    expect(ctx.logger).toBe(fallbackLogger);
  });

  it('uses fallback logger when overflow has no logger', () => {
    const overflow: OverflowContext = { slot: 's' };
    const ctx = compressionContextFromOverflow(overflow, {
      tokenCounter,
      fallbackLogger,
    });
    expect(ctx.logger).toBe(fallbackLogger);
  });

  it('maps overflow strategy logger to Logger', () => {
    const info = vi.fn();
    const overflow: OverflowContext = {
      slot: 's',
      logger: { info, warn: vi.fn(), error: vi.fn() },
    };
    const ctx = compressionContextFromOverflow(overflow, {
      tokenCounter,
      fallbackLogger,
    });
    ctx.logger.info('x');
    expect(info).toHaveBeenCalledWith('x');
  });

  it('derives anchorText from ContentItem anchorTo', () => {
    const item: ContentItem = {
      id: createContentId(),
      role: 'user',
      content: 'anchor body',
      slot: 'history',
      createdAt: 1,
    };
    const overflow: OverflowContext = {
      slot: 'history',
      slotConfig: {
        priority: 50,
        budget: { fixed: 10 },
        overflowConfig: { anchorTo: item },
      },
    };
    const ctx = compressionContextFromOverflow(overflow, {
      tokenCounter,
      fallbackLogger,
    });
    expect(ctx.anchorText).toBe('anchor body');
  });
});

describe('overflowStrategyLoggerToLogger', () => {
  it('forwards to underlying logger', () => {
    const warn = vi.fn();
    const log = overflowStrategyLoggerToLogger({
      info: vi.fn(),
      warn,
      error: vi.fn(),
    });
    log.warn('w');
    expect(warn).toHaveBeenCalledWith('w');
  });
});
