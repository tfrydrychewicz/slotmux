/**
 * Performance SLA integration checks (build latency, budget resolution, snapshot serialize, heap).
 * Traceability: implementation plan Phase 14.2, design doc chapter on performance targets.
 *
 * Build timings use `redaction: false`, `overflow: 'truncate'`, and per-item `tokens` so the
 * pipeline uses {@link sumCachedItemTokens} (no live tokenizer in the orchestrator path).
 *
 * @packageDocumentation
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  BudgetAllocator,
  Context,
  ContextSnapshot,
  clearRegisteredModels,
  toTokenCount,
  validateContextConfig,
  type ContextPushItemInput,
  type CompiledMessage,
  type SlotConfig,
  type SlotMeta,
  type SnapshotMeta,
} from '../../src/index.js';
import { summarizeLatenciesMs } from '../benchmarks/latency-stats.js';

afterEach(() => {
  clearRegisteredModels();
});

function batchRows(count: number, tokensPerRow: number): ContextPushItemInput[] {
  return Array.from({ length: count }, (_, i) => ({
    content: `sla-${i}`,
    tokens: toTokenCount(tokensPerRow),
  }));
}

function slotsThreeSla(): Record<string, SlotConfig> {
  return {
    system: {
      priority: 100,
      budget: { fixed: 5000 },
      defaultRole: 'system',
      position: 'before',
      overflow: 'truncate',
    },
    s1: {
      priority: 80,
      budget: { fixed: 250_000 },
      defaultRole: 'user',
      position: 'after',
      overflow: 'truncate',
    },
    s2: {
      priority: 70,
      budget: { fixed: 250_000 },
      defaultRole: 'user',
      position: 'after',
      overflow: 'truncate',
    },
  };
}

function slotsFiveSla(): Record<string, SlotConfig> {
  const slots: Record<string, SlotConfig> = {};
  for (let i = 0; i < 5; i++) {
    slots[`c${i}`] = {
      priority: 100 - i * 5,
      budget: { fixed: 500_000 },
      defaultRole: 'user',
      position: i === 0 ? 'before' : 'after',
      overflow: 'truncate',
    };
  }
  return slots;
}

function slotsTwentyPercent(): Record<string, SlotConfig> {
  const slots: Record<string, SlotConfig> = {};
  for (let i = 0; i < 20; i++) {
    slots[`s${i}`] = {
      priority: 100 - i,
      budget: { percent: 5 },
      defaultRole: 'user',
      position: 'after',
      overflow: 'truncate',
    };
  }
  return slots;
}

function metaBase(partial: Partial<SnapshotMeta> = {}): SnapshotMeta {
  return {
    totalTokens: toTokenCount(50_000),
    totalBudget: toTokenCount(200_000),
    utilization: 0.25,
    waste: toTokenCount(0),
    slots: {
      history: {
        name: 'history',
        budgetTokens: toTokenCount(100_000),
        usedTokens: toTokenCount(50_000),
        itemCount: 400,
        evictedCount: 0,
        overflowTriggered: false,
        utilization: 0.5,
      },
    },
    compressions: [],
    evictions: [],
    warnings: [],
    buildTimeMs: 0,
    builtAt: Date.now(),
    ...partial,
  };
}

/** ~50k-token-class payload: large total text in messages (serialization + SHA-256). */
function buildLargeSnapshotMessages(): CompiledMessage[] {
  const chunk = 'α'.repeat(500);
  return Array.from({ length: 400 }, (_, i) => ({
    role: 'user' as const,
    content: `${chunk}:${i}`,
  }));
}

describe('Performance SLAs (integration)', () => {
  it('Context.build() — 100 messages, 3 slots: p99 < 5ms', async () => {
    const parsed = validateContextConfig({
      model: 'gpt-4o-mini',
      maxTokens: 1_000_000,
      redaction: false,
      slots: slotsThreeSla(),
    });
    const ctx = Context.fromParsedConfig(parsed);
    ctx.system('system-prompt-sla');
    ctx.push('s1', batchRows(50, 8));
    ctx.push('s2', batchRows(49, 8));

    for (let w = 0; w < 40; w++) {
      await ctx.build();
    }

    const SAMPLES = 120;
    const ms: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const t0 = performance.now();
      await ctx.build();
      ms.push(performance.now() - t0);
    }

    const s = summarizeLatenciesMs(ms);
    expect(s.p99Ms).toBeLessThan(5);
  });

  it('Context.build() — 1000 messages, 5 slots: p99 < 20ms', async () => {
    const parsed = validateContextConfig({
      model: 'gpt-4o-mini',
      maxTokens: 4_000_000,
      redaction: false,
      slots: slotsFiveSla(),
    });
    const ctx = Context.fromParsedConfig(parsed);
    for (let i = 0; i < 5; i++) {
      ctx.push(`c${i}`, batchRows(200, 6));
    }

    for (let w = 0; w < 25; w++) {
      await ctx.build();
    }

    const SAMPLES = 80;
    const ms: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const t0 = performance.now();
      await ctx.build();
      ms.push(performance.now() - t0);
    }

    const s = summarizeLatenciesMs(ms);
    expect(s.p99Ms).toBeLessThan(20);
  });

  it('BudgetAllocator.resolve — 20 slots: p99 < 0.5ms', () => {
    const slots = slotsTwentyPercent();
    const alloc = new BudgetAllocator();

    for (let w = 0; w < 500; w++) {
      alloc.resolve(slots, 1_000_000);
    }

    const SAMPLES = 2000;
    const ms: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const t0 = performance.now();
      alloc.resolve(slots, 1_000_000);
      ms.push(performance.now() - t0);
    }

    const s = summarizeLatenciesMs(ms);
    expect(s.p99Ms).toBeLessThan(0.5);
  });

  it('ContextSnapshot.serialize — ~50k-token-class payload: p99 < 10ms', () => {
    const messages = buildLargeSnapshotMessages();
    const slotsRecord: Record<string, SlotMeta> = {};
    for (let i = 0; i < 5; i++) {
      const name = `c${i}`;
      slotsRecord[name] = {
        name,
        budgetTokens: toTokenCount(50_000),
        usedTokens: toTokenCount(10_000),
        itemCount: 80,
        evictedCount: 0,
        overflowTriggered: false,
        utilization: 0.2,
      };
    }

    const snap = ContextSnapshot.create({
      messages,
      meta: metaBase({ slots: slotsRecord }),
      model: 'gpt-4o-mini',
      immutable: true,
    });

    for (let w = 0; w < 30; w++) {
      snap.serialize();
    }

    const SAMPLES = 100;
    const ms: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const t0 = performance.now();
      snap.serialize();
      ms.push(performance.now() - t0);
    }

    const s = summarizeLatenciesMs(ms);
    expect(s.p99Ms).toBeLessThan(10);
  });

  it.skipIf(typeof globalThis.gc !== 'function')(
    'idle Context — 1000 messages: retained heap < 50MB after GC (run with NODE_OPTIONS=--expose-gc for full CI)',
    async () => {
      const parsed = validateContextConfig({
        model: 'gpt-4o-mini',
        maxTokens: 2_002_100,
        redaction: false,
        slots: {
          system: {
            priority: 100,
            budget: { fixed: 2000 },
            defaultRole: 'system',
            position: 'before',
            overflow: 'truncate',
          },
          history: {
            priority: 50,
            budget: { fixed: 2_000_000 },
            defaultRole: 'user',
            position: 'after',
            overflow: 'truncate',
          },
        },
      });
      const ctx = Context.fromParsedConfig(parsed);
      ctx.system('sys');
      ctx.push('history', batchRows(1000, 4));

      globalThis.gc!();
      const heapBefore = process.memoryUsage().heapUsed;

      await ctx.build();
      // Hold the context so retained graph is measured.
      expect(ctx).toBeDefined();

      globalThis.gc!();
      const heapAfter = process.memoryUsage().heapUsed;
      const delta = heapAfter - heapBefore;

      expect(delta).toBeLessThan(50 * 1024 * 1024);
    },
  );
});
