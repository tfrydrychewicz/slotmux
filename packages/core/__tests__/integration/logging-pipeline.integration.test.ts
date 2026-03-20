/**
 * Phase 10.1 — Structured logging across the build pipeline (§13.3).
 *
 * @packageDocumentation
 */

import { describe, expect, it, vi } from 'vitest';

import {
  Context,
  LogLevel,
  toTokenCount,
  validateContextConfig,
  type Logger,
} from '../../src/index.js';
import { truncateStrategy } from '../../src/slots/strategies/truncate-strategy.js';

/** Chat layout with history using FIFO truncate. */
const CHAT_TRUNCATE_HISTORY = {
  system: {
    priority: 100,
    budget: { fixed: 80 },
    overflow: 'truncate' as const,
    position: 'before' as const,
  },
  history: {
    priority: 50,
    budget: { percent: 100 },
    overflow: 'truncate' as const,
    position: 'after' as const,
  },
};

function captureLogger(): { readonly log: Logger; readonly calls: string[] } {
  const calls: string[] = [];
  const log: Logger = {
    trace: (m, ...args) => {
      calls.push(`trace:${String(m)}${args.length ? `:${JSON.stringify(args)}` : ''}`);
    },
    debug: (m, ...args) => {
      calls.push(`debug:${String(m)}${args.length ? `:${JSON.stringify(args)}` : ''}`);
    },
    info: (m, ...args) => {
      calls.push(`info:${String(m)}${args.length ? `:${JSON.stringify(args)}` : ''}`);
    },
    warn: (m, ...args) => {
      calls.push(`warn:${String(m)}${args.length ? `:${JSON.stringify(args)}` : ''}`);
    },
    error: (m, ...args) => {
      calls.push(`error:${String(m)}${args.length ? `:${JSON.stringify(args)}` : ''}`);
    },
  };
  return { log, calls };
}

describe('Logging pipeline integration (Phase 10.1 — §13.3)', () => {
  it('emits contextual debug lines with operationId through a full build', async () => {
    const { log, calls } = captureLogger();
    const parsed = validateContextConfig({
      model: 'gpt-4o-mini',
      maxTokens: 600,
      reserveForResponse: 0,
      slots: CHAT_TRUNCATE_HISTORY,
      logger: log,
      logLevel: LogLevel.DEBUG,
    });
    const ctx = Context.fromParsedConfig(parsed);
    ctx.system('sys');
    for (let i = 0; i < 40; i++) {
      ctx.user(`message-${i}`);
    }

    await ctx.build({ operationId: 'test-op-42' });

    const joined = calls.join('\n');
    expect(joined).toContain('[op=test-op-42]');
    expect(joined).toContain('build: pipeline started');
    expect(joined).toContain('build: slot budgets resolved');
    expect(joined).toContain('build: overflow resolution');
    expect(joined).toContain('build: overflow complete');
    expect(joined).toContain('build: complete');
  });

  it('includes slot (+ op) in OverflowContext.logger messages from a custom strategy', async () => {
    const debug = vi.fn();
    const slotsWithLoggingOverflow = {
      ...CHAT_TRUNCATE_HISTORY,
      history: {
        ...CHAT_TRUNCATE_HISTORY.history,
        overflow: (
          items: Parameters<typeof truncateStrategy>[0],
          budget: Parameters<typeof truncateStrategy>[1],
          ctx: Parameters<typeof truncateStrategy>[2],
        ) => {
          ctx.logger?.debug?.('custom strategy');
          return truncateStrategy(items, budget, ctx);
        },
      },
    };
    const parsed = validateContextConfig({
      model: 'm',
      maxTokens: 500,
      slots: slotsWithLoggingOverflow,
      logger: {
        trace: vi.fn(),
        debug,
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      logLevel: LogLevel.DEBUG,
    });
    const ctx = Context.fromParsedConfig(parsed);
    ctx.system('S');
    for (let i = 0; i < 30; i++) {
      ctx.push('history', [{ content: `u-${i}`, tokens: toTokenCount(100) }]);
    }

    await ctx.build({ operationId: 'slot-test' });

    const strategyLogs = debug.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('custom strategy'),
    );
    expect(strategyLogs.length).toBeGreaterThan(0);
    expect(String(strategyLogs[0]![0])).toContain('op=slot-test');
    expect(String(strategyLogs[0]![0])).toContain('slot=history');
  });
});
