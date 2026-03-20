/**
 * Snapshot schema migrations (§12.1 — Phase 9.2).
 *
 * @packageDocumentation
 */

import { SnapshotCorruptedError } from '../errors.js';
import { toTokenCount } from '../types/branded.js';
import type { CompiledMessage } from '../types/content.js';
import type { SerializedSnapshot, SlotMeta, SnapshotMeta } from '../types/snapshot.js';

import { cloneCompiledMessage } from './clone-compiled-message.js';
import { sealSerializedSnapshotV1 } from './snapshot-seal.js';

/** One step: transform a snapshot from `from` version toward the current wire format. */
export interface SnapshotMigrationStep {
  /** Source schema version string stored on the snapshot (`data.version`). */
  readonly from: string;
  /** Version after this step (next hop toward {@link CURRENT_SNAPSHOT_SCHEMA_VERSION}). */
  readonly to: string;
  /**
   * Receives the full prior object; returns the next object (must set `version` to {@link SnapshotMigrationStep.to}).
   * Should not set `checksum` — sealing runs after the chain reaches `1.0`.
   */
  readonly migrate: (data: unknown) => unknown;
}

export const CURRENT_SNAPSHOT_SCHEMA_VERSION = '1.0' as const;

/**
 * Built-in migrations (earliest → latest). Extend with {@link registerSnapshotMigration}.
 */
export const BUILTIN_SNAPSHOT_MIGRATIONS: readonly SnapshotMigrationStep[] = [
  {
    from: '0.9',
    to: '1.0',
    migrate: migrateSnapshot_0_9_to_1_0,
  },
];

const extraMigrations: SnapshotMigrationStep[] = [];

/**
 * Register an extra migration (e.g. app-specific legacy format). For a given `from` version,
 * the last registration wins over earlier extras and over the built-in step with the same `from`.
 */
export function registerSnapshotMigration(step: SnapshotMigrationStep): void {
  extraMigrations.push(step);
}

export function getSnapshotMigrationSteps(): readonly SnapshotMigrationStep[] {
  return [...BUILTIN_SNAPSHOT_MIGRATIONS, ...extraMigrations];
}

function findMigrationFor(from: string): SnapshotMigrationStep | undefined {
  for (let i = extraMigrations.length - 1; i >= 0; i--) {
    const s = extraMigrations[i]!;
    if (s.from === from) return s;
  }
  return BUILTIN_SNAPSHOT_MIGRATIONS.find((s) => s.from === from);
}

function readVersion(data: unknown): string {
  if (data === null || typeof data !== 'object') {
    throw new SnapshotCorruptedError('migrate: expected object', {
      context: { received: typeof data },
    });
  }
  const v = (data as { version?: unknown }).version;
  if (typeof v !== 'string' || v.length === 0) {
    throw new SnapshotCorruptedError('migrate: missing or invalid version', {
      context: { version: v },
    });
  }
  return v;
}

/**
 * Applies the migration chain until `version === '1.0'`, then seals checksum.
 * When data is already v1.0 with a non-empty checksum, returns it unchanged (caller should verify via deserialize).
 */
export function migrateSnapshotDataToSerializedV1(data: unknown): SerializedSnapshot {
  if (data === null || typeof data !== 'object') {
    throw new SnapshotCorruptedError('migrate: expected object', {
      context: { received: typeof data },
    });
  }

  let current: unknown = data;
  let version = readVersion(current);

  if (version === CURRENT_SNAPSHOT_SCHEMA_VERSION) {
    const snap = current as SerializedSnapshot;
    if (typeof snap.checksum === 'string' && snap.checksum.length > 0) {
      return snap;
    }
    return sealPartialV1Snapshot(current);
  }

  const guard = 32;
  let steps = 0;
  while (version !== CURRENT_SNAPSHOT_SCHEMA_VERSION) {
    if (steps++ > guard) {
      throw new SnapshotCorruptedError('migrate: migration chain exceeded step limit', {
        context: { lastVersion: version },
      });
    }
    const step = findMigrationFor(version);
    if (step === undefined) {
      throw new SnapshotCorruptedError(`migrate: no migration registered for version "${version}"`, {
        context: { version },
      });
    }
    current = step.migrate(current);
    const nextV = readVersion(current);
    if (nextV !== step.to) {
      throw new SnapshotCorruptedError('migrate: migration produced unexpected version', {
        context: { expected: step.to, received: nextV },
      });
    }
    version = nextV;
  }

  return sealPartialV1Snapshot(current);
}

function sealPartialV1Snapshot(data: unknown): SerializedSnapshot {
  if (data === null || typeof data !== 'object') {
    throw new SnapshotCorruptedError('migrate: internal — expected object before seal', {});
  }
  const d = data as Partial<SerializedSnapshot>;
  if (
    typeof d.id !== 'string' ||
    typeof d.model !== 'string' ||
    !Array.isArray(d.messages) ||
    d.meta === null ||
    typeof d.meta !== 'object' ||
    d.slots === null ||
    typeof d.slots !== 'object'
  ) {
    throw new SnapshotCorruptedError('migrate: invalid v1.0 snapshot shape before seal', {
      context: { keys: Object.keys(d) },
    });
  }
  const messages = d.messages.map((m) => cloneCompiledMessage(m as CompiledMessage));
  const meta = { ...d.meta } as SnapshotMeta;
  const slotsCopy = { ...d.slots };
  return sealSerializedSnapshotV1({
    version: '1.0',
    id: d.id,
    model: d.model,
    slots: slotsCopy,
    messages,
    meta,
  });
}

/**
 * Synthetic legacy **0.9** shape (tests / docs only): no top-level `slots`; `meta.slotStats` holds minimal
 * per-slot numbers; `meta.slots` and several arrays may be absent.
 */
function migrateSnapshot_0_9_to_1_0(data: unknown): unknown {
  if (data === null || typeof data !== 'object') {
    throw new SnapshotCorruptedError('migrate 0.9→1.0: expected object', {});
  }
  const d = data as Record<string, unknown>;
  if (
    typeof d['id'] !== 'string' ||
    typeof d['model'] !== 'string' ||
    !Array.isArray(d['messages'])
  ) {
    throw new SnapshotCorruptedError('migrate 0.9→1.0: invalid shape', {
      context: { keys: Object.keys(d) },
    });
  }
  const metaIn = d['meta'];
  if (metaIn === null || typeof metaIn !== 'object') {
    throw new SnapshotCorruptedError('migrate 0.9→1.0: invalid meta', {});
  }
  const m = metaIn as Record<string, unknown>;

  const slotStats = m['slotStats'];
  const slots: Record<string, SlotMeta> = {};
  if (slotStats !== null && typeof slotStats === 'object') {
    for (const [name, raw] of Object.entries(slotStats)) {
      if (raw === null || typeof raw !== 'object') continue;
      const s = raw as Record<string, unknown>;
      const budget =
        typeof s['budgetTokens'] === 'number'
          ? s['budgetTokens']
          : Number(s['budgetTokens'] ?? s['budget'] ?? 0);
      const used =
        typeof s['usedTokens'] === 'number'
          ? s['usedTokens']
          : Number(s['usedTokens'] ?? s['used'] ?? 0);
      const budgetTokens = toTokenCount(Number.isFinite(budget) ? budget : 0);
      const usedTokens = toTokenCount(Number.isFinite(used) ? used : 0);
      const utilization =
        budgetTokens > 0 ? Math.min(1, Math.max(0, usedTokens / budgetTokens)) : 0;
      slots[name] = {
        name,
        budgetTokens,
        usedTokens,
        itemCount: typeof s['itemCount'] === 'number' ? s['itemCount'] : 0,
        evictedCount: typeof s['evictedCount'] === 'number' ? s['evictedCount'] : 0,
        overflowTriggered: Boolean(s['overflowTriggered']),
        utilization: typeof s['utilization'] === 'number' ? s['utilization'] : utilization,
      };
    }
  }

  const totalTokens = toTokenCount(
    typeof m['totalTokens'] === 'number' ? m['totalTokens'] : Number(m['totalTokens'] ?? 0),
  );
  const totalBudget = toTokenCount(
    typeof m['totalBudget'] === 'number' ? m['totalBudget'] : Number(m['totalBudget'] ?? 0),
  );
  const utilization =
    typeof m['utilization'] === 'number'
      ? m['utilization']
      : totalBudget > 0
        ? Math.min(1, Math.max(0, totalTokens / totalBudget))
        : 0;
  const waste = toTokenCount(
    typeof m['waste'] === 'number' ? m['waste'] : Number(m['waste'] ?? 0),
  );

  const compressions = Array.isArray(m['compressions']) ? m['compressions'] : [];
  const evictions = Array.isArray(m['evictions']) ? m['evictions'] : [];
  const warnings = Array.isArray(m['warnings']) ? m['warnings'] : [];
  const buildTimeMs = typeof m['buildTimeMs'] === 'number' ? m['buildTimeMs'] : 0;
  const builtAt = typeof m['builtAt'] === 'number' ? m['builtAt'] : 0;

  const mSlots = m['slots'];
  const metaSlots =
    mSlots !== null && typeof mSlots === 'object' && Object.keys(mSlots).length > 0
      ? (mSlots as Record<string, SlotMeta>)
      : slots;

  const meta: SnapshotMeta = {
    totalTokens,
    totalBudget,
    utilization,
    waste,
    slots: metaSlots,
    compressions: compressions as SnapshotMeta['compressions'],
    evictions: evictions as SnapshotMeta['evictions'],
    warnings: warnings as SnapshotMeta['warnings'],
    buildTimeMs,
    builtAt,
  };

  const messages = (d['messages'] as unknown[]).map((x) =>
    cloneCompiledMessage(x as CompiledMessage),
  );

  return {
    version: '1.0',
    id: d['id'],
    model: d['model'],
    slots: { ...metaSlots },
    messages,
    meta: { ...meta, slots: { ...metaSlots } },
  };
}

/** @internal reset extra migrations — unit tests only */
export function __resetSnapshotMigrationsForTests(): void {
  extraMigrations.length = 0;
}
