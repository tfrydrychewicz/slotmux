import { describe, expect, it } from 'vitest';

import { ContextSnapshot } from '../../src/snapshot/context-snapshot.js';
import { createContentId, toTokenCount } from '../../src/types/branded.js';
import type { ProviderId } from '../../src/types/config.js';
import type { CompiledMessage, ContentItem } from '../../src/types/content.js';
import type {
  SlotMeta,
  CompressionEvent,
  EvictionEvent,
  ContextWarning,
  SnapshotMeta,
  SnapshotDiff,
  SerializedSnapshot,
} from '../../src/types/snapshot.js';

describe('SlotMeta', () => {
  it('accepts full slot meta', () => {
    const meta: SlotMeta = {
      name: 'history',
      budgetTokens: toTokenCount(5000),
      usedTokens: toTokenCount(3200),
      itemCount: 15,
      evictedCount: 2,
      overflowTriggered: true,
      utilization: 0.64,
    };
    expect(meta.name).toBe('history');
    expect(meta.utilization).toBe(0.64);
  });
});

describe('CompressionEvent', () => {
  it('accepts compression event', () => {
    const event: CompressionEvent = {
      slot: 'history',
      beforeTokens: 8000,
      afterTokens: 2000,
      itemCount: 20,
      ratio: 0.75,
    };
    expect(event.slot).toBe('history');
    expect(event.ratio).toBe(0.75);
  });
});

describe('EvictionEvent', () => {
  it('accepts eviction event', () => {
    const item: ContentItem = {
      id: createContentId(),
      role: 'user',
      content: 'Evicted message',
      slot: 'history',
      createdAt: Date.now(),
    };
    const event: EvictionEvent = {
      slot: 'history',
      item,
      reason: 'overflow',
    };
    expect(event.reason).toBe('overflow');
  });
});

describe('ContextWarning', () => {
  it('accepts warning with all severities', () => {
    const warnings: ContextWarning[] = [
      { code: 'NEAR_OVERFLOW', message: 'Slot at 95%', slot: 'history', severity: 'info' },
      { code: 'PROTECTED_OVER_BUDGET', message: 'Protected slot exceeded', severity: 'warn' },
      { code: 'BUDGET_EXCEEDED', message: 'Fixed slots exceed total', severity: 'error' },
    ];
    expect(warnings).toHaveLength(3);
  });
});

describe('SnapshotMeta', () => {
  it('accepts full snapshot meta', () => {
    const meta: SnapshotMeta = {
      totalTokens: toTokenCount(4000),
      totalBudget: toTokenCount(8000),
      utilization: 0.5,
      waste: toTokenCount(500),
      slots: {
        system: {
          name: 'system',
          budgetTokens: toTokenCount(1500),
          usedTokens: toTokenCount(1200),
          itemCount: 1,
          evictedCount: 0,
          overflowTriggered: false,
          utilization: 0.8,
        },
      },
      compressions: [],
      evictions: [],
      warnings: [],
      buildTimeMs: 12,
      builtAt: Date.now(),
    };
    expect(meta.utilization).toBe(0.5);
    expect(meta.buildTimeMs).toBe(12);
  });
});

describe('SnapshotDiff', () => {
  it('accepts diff with added, removed, modified', () => {
    const msg: CompiledMessage = { role: 'user', content: 'Hello' };
    const diff: SnapshotDiff = {
      added: [msg],
      removed: [],
      modified: [
        { index: 0, before: { role: 'system', content: 'Old' }, after: { role: 'system', content: 'New' } },
      ],
    };
    expect(diff.added).toHaveLength(1);
    expect(diff.modified).toHaveLength(1);
  });
});

describe('SerializedSnapshot', () => {
  it('accepts serialized snapshot', () => {
    const serialized: SerializedSnapshot = {
      version: '1.0',
      id: 'snap-123',
      model: 'gpt-4-turbo',
      slots: {},
      messages: [{ role: 'system', content: 'You are helpful.' }],
      meta: {
        totalTokens: toTokenCount(10),
        totalBudget: toTokenCount(8000),
        utilization: 0.00125,
        waste: toTokenCount(0),
        slots: {},
        compressions: [],
        evictions: [],
        warnings: [],
        buildTimeMs: 5,
        builtAt: Date.now(),
      },
      checksum: 'abc123',
    };
    expect(serialized.version).toBe('1.0');
    expect(serialized.checksum).toBe('abc123');
  });
});

describe('ContextSnapshot', () => {
  it('create + format + serialize + diff', () => {
    const messages: CompiledMessage[] = [{ role: 'user', content: 'Hi' }];
    const meta: SnapshotMeta = {
      totalTokens: toTokenCount(5),
      totalBudget: toTokenCount(8000),
      utilization: 0.000625,
      waste: toTokenCount(0),
      slots: {},
      compressions: [],
      evictions: [],
      warnings: [],
      buildTimeMs: 1,
      builtAt: Date.now(),
    };

    const snapshot = ContextSnapshot.create({
      id: 'snap-1',
      messages,
      meta,
      model: 'gpt-4-turbo',
      immutable: false,
    });

    expect(snapshot.id).toBe('snap-1');
    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.format('openai')).toEqual(messages);
    expect(snapshot.serialize().version).toBe('1.0');
    expect(snapshot.diff(snapshot).added).toHaveLength(0);
  });

  it('format delegates to provider adapter when registered', () => {
    const snapshot = ContextSnapshot.create({
      id: 'a',
      messages: [{ role: 'user', content: 'x' }],
      meta: {
        totalTokens: toTokenCount(1),
        totalBudget: toTokenCount(100),
        utilization: 0.01,
        waste: toTokenCount(0),
        slots: {},
        compressions: [],
        evictions: [],
        warnings: [],
        buildTimeMs: 0,
        builtAt: 0,
      },
      model: 'm',
      immutable: false,
      providerAdapters: {
        openai: {
          id: 'openai' as ProviderId,
          resolveModel: () => ({
            maxContextTokens: 100,
            maxOutputTokens: 10,
            supportsFunctions: false,
            supportsVision: false,
            supportsStreaming: true,
            tokenizerName: 't',
          }),
          formatMessages: (msgs) => ({ provider: 'openai', n: msgs.length }),
          getTokenizer: () => {
            throw new Error('unused');
          },
          calculateOverhead: () => toTokenCount(0),
        },
      },
    });
    expect(snapshot.format('openai')).toEqual({ provider: 'openai', n: 1 });
  });

  it("format('text') returns plain text concatenation", () => {
    const snapshot = ContextSnapshot.create({
      id: 't',
      messages: [
        { role: 'system', content: 'Rules' },
        { role: 'user', content: 'Go' },
      ],
      meta: {
        totalTokens: toTokenCount(1),
        totalBudget: toTokenCount(100),
        utilization: 0.01,
        waste: toTokenCount(0),
        slots: {},
        compressions: [],
        evictions: [],
        warnings: [],
        buildTimeMs: 0,
        builtAt: 0,
      },
      model: 'm',
      immutable: false,
    });
    expect(snapshot.format('text')).toBe('Rules\n\nGo');
  });
});
