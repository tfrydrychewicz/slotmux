/**
 * Compile-time type assertions (expect-type). Failures surface via `tsc` / `pnpm typecheck`.
 *
 * @packageDocumentation
 */
import { expectTypeOf } from 'expect-type';
import { describe, expect, it } from 'vitest';

import { SlotOverflow } from '../../src/slots/slot-overflow.js';
import type { ContextSnapshot } from '../../src/snapshot/context-snapshot.js';
import type { TokenCount, ContentId, SlotPriority } from '../../src/types/branded.js';
import type {
  OverflowStrategyFn,
  SlotBudget,
  SlotBudgetBoundedFlex,
  SlotBudgetFixed,
  SlotBudgetFlex,
  SlotBudgetPercent,
  SlotConfig,
  SlotOverflowStrategy,
} from '../../src/types/config.js';
import type { CompiledMessage } from '../../src/types/content.js';
import type { ContextEvent } from '../../src/types/events.js';
import type {
  CompressionEvent,
  SnapshotMeta,
  SlotMeta,
} from '../../src/types/snapshot.js';

/** Exercises control-flow narrowing for {@link SlotBudget} (compile-time). */
function exerciseSlotBudgetNarrowing(b: SlotBudget): void {
  if ('fixed' in b) {
    expectTypeOf(b).toEqualTypeOf<SlotBudgetFixed>();
    expectTypeOf(b.fixed).toBeNumber();
    return;
  }
  if ('percent' in b) {
    expectTypeOf(b).toEqualTypeOf<SlotBudgetPercent>();
    expectTypeOf(b.percent).toBeNumber();
    return;
  }
  if ('flex' in b && b.flex === true) {
    if ('min' in b) {
      expectTypeOf(b).toEqualTypeOf<SlotBudgetBoundedFlex>();
      expectTypeOf(b.min).toBeNumber();
      expectTypeOf(b.max).toBeNumber();
    } else {
      expectTypeOf(b).toMatchTypeOf<SlotBudgetFlex>();
    }
  }
}

describe('type level: SlotBudget', () => {
  it('narrows fixed, percent, flex, and bounded flex', () => {
    exerciseSlotBudgetNarrowing({ fixed: 1024 });
    exerciseSlotBudgetNarrowing({ percent: 40 });
    exerciseSlotBudgetNarrowing({ flex: true });
    exerciseSlotBudgetNarrowing({ min: 10, max: 100, flex: true });
    expect(true).toBe(true);
  });
});

describe('type level: ContextEvent', () => {
  it('narrows on type discriminator', () => {
    function exercise(e: ContextEvent): void {
      switch (e.type) {
        case 'content:added':
          expectTypeOf(e.item).toBeObject();
          expectTypeOf(e.slot).toBeString();
          break;
        case 'slot:overflow':
          expectTypeOf(e.strategy).toBeString();
          expectTypeOf(e.beforeTokens).toBeNumber();
          break;
        case 'build:complete':
          expectTypeOf(e.snapshot).toEqualTypeOf<ContextSnapshot>();
          break;
        case 'warning':
          expectTypeOf(e.warning.severity).toEqualTypeOf<
            'info' | 'warn' | 'error'
          >();
          break;
        default:
          break;
      }
    }

    // Body is type-checked by `tsc`; no runtime calls required for each branch.
    void exercise;
    expect(true).toBe(true);
  });
});

describe('type level: OverflowStrategyFn', () => {
  it('extends SlotOverflowStrategy and is assignable to SlotConfig.overflow', () => {
    expectTypeOf<OverflowStrategyFn>().toExtend<SlotOverflowStrategy>();

    const custom: OverflowStrategyFn = (items) => items;
    const slot: SlotConfig = {
      priority: 50,
      budget: { flex: true },
      overflow: custom,
    };
    expect(slot.overflow).toBe(custom);
  });
});

describe('type level: SlotOverflow', () => {
  it('presets are assignable to SlotOverflowStrategy', () => {
    expectTypeOf(SlotOverflow.SUMMARIZE).toExtend<SlotOverflowStrategy>();
    expectTypeOf(SlotOverflow.TRUNCATE_LATEST).toExtend<SlotOverflowStrategy>();
  });
});

describe('type level: ContextSnapshot immutability', () => {
  it('uses readonly messages and readonly nested meta collections', () => {
    expectTypeOf<ContextSnapshot['messages']>().toEqualTypeOf<
      readonly Readonly<CompiledMessage>[]
    >();
    expectTypeOf<ContextSnapshot['immutable']>().toBeBoolean();
    expectTypeOf<ContextSnapshot['meta']>().toEqualTypeOf<SnapshotMeta>();
    expectTypeOf<ContextSnapshot['meta']['slots']>().toEqualTypeOf<
      Readonly<Record<string, SlotMeta>>
    >();
    expectTypeOf<ContextSnapshot['meta']['compressions']>().toEqualTypeOf<
      readonly CompressionEvent[]
    >();
  });
});

describe('type level: branded primitives', () => {
  it('rejects plain number as TokenCount or SlotPriority', () => {
    expectTypeOf<number>().not.toMatchTypeOf<TokenCount>();
    expectTypeOf<number>().not.toMatchTypeOf<SlotPriority>();
  });

  it('rejects plain string as ContentId', () => {
    expectTypeOf<string>().not.toMatchTypeOf<ContentId>();
  });

  it('allows branded types to widen to base primitives where intended', () => {
    expectTypeOf<TokenCount>().toMatchTypeOf<number>();
    expectTypeOf<ContentId>().toMatchTypeOf<string>();
  });
});
