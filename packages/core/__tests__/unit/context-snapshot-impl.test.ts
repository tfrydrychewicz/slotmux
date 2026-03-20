import { describe, expect, it } from 'vitest';

import { SnapshotCorruptedError } from '../../src/errors.js';
import { ContextSnapshot } from '../../src/snapshot/context-snapshot.js';
import { toTokenCount } from '../../src/types/branded.js';
import type { CompiledMessage } from '../../src/types/content.js';
import type { SnapshotMeta } from '../../src/types/snapshot.js';

function meta(partial: Partial<SnapshotMeta> = {}): SnapshotMeta {
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
    ...partial,
  };
}

describe('ContextSnapshot Phase 5.5', () => {
  it('serialize + deserialize round-trip with SHA-256 checksum', () => {
    const messages: CompiledMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ];
    const snap = ContextSnapshot.create({
      id: 'id-round',
      messages,
      meta: meta(),
      model: 'gpt-4o',
      immutable: true,
    });
    const wire = snap.serialize();
    const restored = ContextSnapshot.deserialize(wire);
    expect(restored.id).toBe(snap.id);
    expect(restored.messages).toHaveLength(2);
    expect(restored.messages[0]).toEqual(messages[0]);
    expect(restored.immutable).toBe(true);
    expect(Object.isFrozen(restored.messages)).toBe(true);
  });

  it('immutable: false skips deep freeze', () => {
    const snap = ContextSnapshot.create({
      messages: [{ role: 'user', content: 'a' }],
      meta: meta(),
      model: 'm',
      immutable: false,
    });
    expect(snap.immutable).toBe(false);
    expect(Object.isFrozen(snap.messages)).toBe(false);
  });

  it('deserialize throws SnapshotCorruptedError on checksum mismatch', () => {
    const snap = ContextSnapshot.create({
      messages: [{ role: 'user', content: 'x' }],
      meta: meta(),
      model: 'm',
      immutable: false,
    });
    const bad = { ...snap.serialize(), checksum: '0'.repeat(64) };
    expect(() => ContextSnapshot.deserialize(bad)).toThrow(SnapshotCorruptedError);
  });

  it('structural sharing reuses identical message references from previous snapshot', () => {
    const messages: CompiledMessage[] = [{ role: 'user', content: 'same' }];
    const first = ContextSnapshot.create({
      messages,
      meta: meta(),
      model: 'm',
      immutable: true,
    });
    const second = ContextSnapshot.create({
      messages: [...messages],
      meta: meta({ buildTimeMs: 2 }),
      model: 'm',
      immutable: true,
      previousSnapshot: first,
    });
    expect(second.messages[0]).toBe(first.messages[0]);
  });

  it('structuralSharing: false clones even when previous matches', () => {
    const messages: CompiledMessage[] = [{ role: 'user', content: 'same' }];
    const first = ContextSnapshot.create({
      messages,
      meta: meta(),
      model: 'm',
      immutable: true,
    });
    const second = ContextSnapshot.create({
      messages: [...messages],
      meta: meta({ buildTimeMs: 3 }),
      model: 'm',
      immutable: true,
      previousSnapshot: first,
      structuralSharing: false,
    });
    expect(second.messages[0]).not.toBe(first.messages[0]);
  });
});

describe('Phase 9.1 — snapshot serialization (§12.1)', () => {
  it('serialize → JSON.stringify/parse → deserialize round-trip (JSON-safe wire)', () => {
    const messages: CompiledMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
    ];
    const snap = ContextSnapshot.create({
      id: 'wire-1',
      messages,
      meta: meta({
        slots: {
          a: {
            name: 'a',
            budgetTokens: toTokenCount(10),
            usedTokens: toTokenCount(5),
            itemCount: 1,
            evictedCount: 0,
            overflowTriggered: false,
            utilization: 0.5,
          },
        },
      }),
      model: 'gpt-4o',
      immutable: true,
    });
    const serialized = snap.serialize();
    const onDisk = JSON.stringify(serialized);
    const parsed = JSON.parse(onDisk) as unknown;
    const restored = ContextSnapshot.deserialize(parsed);
    expect(restored.id).toBe(snap.id);
    expect(restored.model).toBe(snap.model);
    expect(restored.messages).toEqual(snap.messages);
    expect(restored.meta.slots['a']?.name).toBe('a');
  });

  it('deserialize throws when payload is tampered (messages) but checksum unchanged', () => {
    const snap = ContextSnapshot.create({
      messages: [{ role: 'user', content: 'original' }],
      meta: meta(),
      model: 'm',
      immutable: false,
    });
    const wire = snap.serialize();
    const tampered = {
      ...wire,
      messages: [{ role: 'user', content: 'hacked' }],
    };
    expect(() => ContextSnapshot.deserialize(tampered)).toThrow(SnapshotCorruptedError);
  });

  it('deserialize throws when meta.slots is tampered but checksum unchanged', () => {
    const snap = ContextSnapshot.create({
      messages: [{ role: 'user', content: 'x' }],
      meta: meta({
        slots: {
          s: {
            name: 's',
            budgetTokens: toTokenCount(100),
            usedTokens: toTokenCount(10),
            itemCount: 1,
            evictedCount: 0,
            overflowTriggered: false,
            utilization: 0.1,
          },
        },
      }),
      model: 'm',
      immutable: false,
    });
    const wire = snap.serialize();
    const tampered = {
      ...wire,
      slots: {
        ...wire.slots,
        s: { ...wire.slots['s']!, usedTokens: toTokenCount(99) },
      },
    };
    expect(() => ContextSnapshot.deserialize(tampered)).toThrow(SnapshotCorruptedError);
  });

  it('deserialize throws SnapshotCorruptedError for unsupported version', () => {
    const snap = ContextSnapshot.create({
      messages: [{ role: 'user', content: 'x' }],
      meta: meta(),
      model: 'm',
      immutable: false,
    });
    const wire = snap.serialize();
    expect(() =>
      ContextSnapshot.deserialize({ ...wire, version: '0.9' as '1.0' }),
    ).toThrow(SnapshotCorruptedError);
  });
});
