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
