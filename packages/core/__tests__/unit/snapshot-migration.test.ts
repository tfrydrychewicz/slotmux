import { afterEach, describe, expect, it } from 'vitest';

import { SnapshotCorruptedError } from '../../src/errors.js';
import { ContextSnapshot } from '../../src/snapshot/context-snapshot.js';
import {
  __resetSnapshotMigrationsForTests,
  registerSnapshotMigration,
} from '../../src/snapshot/snapshot-migrations.js';
import { toTokenCount } from '../../src/types/branded.js';
import type { CompiledMessage } from '../../src/types/content.js';
import type { SnapshotMeta } from '../../src/types/snapshot.js';

function metaBase(over: Partial<SnapshotMeta> = {}): SnapshotMeta {
  return {
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
    ...over,
  };
}

afterEach(() => {
  __resetSnapshotMigrationsForTests();
});

describe('Phase 9.2 — snapshot migration (§12.1)', () => {
  it('migrates synthetic v0.9 (slotStats) to ContextSnapshot v1.0', () => {
    const messages: CompiledMessage[] = [{ role: 'user', content: 'legacy' }];
    const legacy = {
      version: '0.9',
      id: 'old-1',
      model: 'gpt-4',
      messages,
      meta: {
        totalTokens: 12,
        totalBudget: 200,
        utilization: 0.06,
        slotStats: {
          history: { budgetTokens: 200, usedTokens: 12 },
        },
      },
    };

    const snap = ContextSnapshot.migrate(legacy);
    expect(snap.id).toBe('old-1');
    expect(snap.model).toBe('gpt-4');
    expect(snap.messages).toHaveLength(1);
    expect(snap.messages[0]!.content).toBe('legacy');
    expect(snap.meta.slots['history']?.name).toBe('history');
    expect(snap.meta.slots['history']?.budgetTokens).toBe(toTokenCount(200));
    expect(snap.meta.slots['history']?.usedTokens).toBe(toTokenCount(12));
    expect(snap.immutable).toBe(true);
  });

  it('migrate(serialize()) is equivalent to deserialize(serialize())', () => {
    const snap = ContextSnapshot.create({
      id: 'r1',
      messages: [{ role: 'system', content: 's' }],
      meta: metaBase(),
      model: 'm',
      immutable: true,
    });
    const wire = snap.serialize();
    const viaMigrate = ContextSnapshot.migrate(wire);
    const viaDeserialize = ContextSnapshot.deserialize(wire);
    expect(viaMigrate.id).toBe(viaDeserialize.id);
    expect(viaMigrate.messages).toEqual(viaDeserialize.messages);
  });

  it('seals v1.0 wire objects that omit checksum', () => {
    const messages: CompiledMessage[] = [{ role: 'user', content: 'x' }];
    const body = {
      version: '1.0' as const,
      id: 'no-sum',
      model: 'm',
      slots: {} as Record<string, never>,
      messages,
      meta: metaBase(),
    };
    const snap = ContextSnapshot.migrate(body);
    expect(snap.id).toBe('no-sum');
    const round = snap.serialize();
    expect(typeof round.checksum).toBe('string');
    expect(round.checksum.length).toBe(64);
  });

  it('throws when no migration exists for version', () => {
    expect(() =>
      ContextSnapshot.migrate({
        version: '0.1',
        id: 'x',
        model: 'm',
        messages: [],
        meta: {},
      }),
    ).toThrow(SnapshotCorruptedError);
  });

  it('registerSnapshotMigration extends the chain (0.8 → 0.9 → 1.0)', () => {
    registerSnapshotMigration({
      from: '0.8',
      to: '0.9',
      migrate: (data: unknown) => {
        const d = data as Record<string, unknown>;
        return {
          ...d,
          version: '0.9',
          meta: {
            ...(d['meta'] as object),
            slotStats: { a: { budgetTokens: 50, usedTokens: 10 } },
          },
        };
      },
    });

    const legacy08 = {
      version: '0.8',
      id: 'eight',
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      meta: {
        totalTokens: 10,
        totalBudget: 50,
        utilization: 0.2,
      },
    };

    const snap = ContextSnapshot.migrate(legacy08);
    expect(snap.id).toBe('eight');
    expect(snap.meta.slots['a']?.usedTokens).toBe(toTokenCount(10));
  });

  it('last registerSnapshotMigration wins for the same from-version', () => {
    registerSnapshotMigration({
      from: '0.7',
      to: '1.0',
      migrate: () => {
        throw new Error('should not run');
      },
    });
    registerSnapshotMigration({
      from: '0.7',
      to: '1.0',
      migrate: (data: unknown) => {
        const d = data as Record<string, unknown>;
        return {
          version: '1.0',
          id: d['id'],
          model: d['model'],
          messages: d['messages'],
          slots: {},
          meta: metaBase(),
        };
      },
    });

    const snap = ContextSnapshot.migrate({
      version: '0.7',
      id: 'seven',
      model: 'm',
      messages: [{ role: 'user', content: 'ok' }] as CompiledMessage[],
    });
    expect(snap.id).toBe('seven');
  });
});
