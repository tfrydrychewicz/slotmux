/**
 * {@link ContextSnapshot} class — immutability, SHA-256 serialize/deserialize (§12.1 / Phase 9.1),
 * {@link ContextSnapshot.migrate} (Phase 9.2), {@link ContextSnapshot.format}, and {@link ContextSnapshot.diff} (§5.5, Phase 9.4).
 *
 * @packageDocumentation
 */

import { SnapshotCorruptedError } from '../errors.js';
import { createContentId } from '../types/branded.js';
import type { ProviderId, SnapshotFormatTarget } from '../types/config.js';
import type { CompiledMessage } from '../types/content.js';
import type { ProviderAdapter } from '../types/provider.js';
import type {
  SerializedSnapshot,
  SnapshotDiff,
  SnapshotMeta,
  SnapshotSlotMetaDiff,
  SlotMeta,
} from '../types/snapshot.js';

import { cloneCompiledMessage, compiledMessageJson } from './clone-compiled-message.js';
import { deepFreeze } from './deep-freeze.js';
import { formatCompiledMessagesAsPlainText } from './format-plain-text.js';
import { sha256HexUtf8 } from './sha256-hex.js';
import { migrateSnapshotDataToSerializedV1 } from './snapshot-migrations.js';
import { sealSerializedSnapshotV1, snapshotV1PayloadString } from './snapshot-seal.js';

export type CreateContextSnapshotParams = {
  /** When omitted, a new content id is generated. */
  readonly id?: string;
  readonly messages: readonly CompiledMessage[];
  readonly meta: SnapshotMeta;
  readonly model: string;
  /**
   * When true (default), deep-freeze messages and meta (ADR-002).
   * Mirrors {@link ContextConfig.immutableSnapshots}.
   */
  readonly immutable?: boolean;
  /** When set, {@link ContextSnapshot.format} delegates to the matching adapter. */
  readonly providerAdapters?: Partial<Record<ProviderId, ProviderAdapter>>;
  /**
   * Prior snapshot for §18.2 structural sharing: reuse message object references
   * when JSON-serialized content matches and both snapshots are immutable.
   */
  readonly previousSnapshot?: ContextSnapshot;
  /** Default true when `previousSnapshot` is set. */
  readonly structuralSharing?: boolean;
};

export type DeserializeContextSnapshotOptions = {
  /** When true (default), deep-freeze restored data. */
  readonly immutable?: boolean;
  readonly providerAdapters?: Partial<Record<ProviderId, ProviderAdapter>>;
};

function slotMetaFieldsEqual(a: Readonly<SlotMeta>, b: Readonly<SlotMeta>): boolean {
  return (
    a.name === b.name &&
    a.budgetTokens === b.budgetTokens &&
    a.usedTokens === b.usedTokens &&
    a.itemCount === b.itemCount &&
    a.evictedCount === b.evictedCount &&
    a.overflowTriggered === b.overflowTriggered &&
    a.utilization === b.utilization
  );
}

function diffSlotMeta(
  beforeSlots: Readonly<Record<string, SlotMeta>>,
  afterSlots: Readonly<Record<string, SlotMeta>>,
): SnapshotSlotMetaDiff[] {
  const out: SnapshotSlotMetaDiff[] = [];
  const names = new Set([...Object.keys(beforeSlots), ...Object.keys(afterSlots)]);
  for (const name of [...names].sort()) {
    const before = beforeSlots[name];
    const after = afterSlots[name];
    if (before !== undefined && after !== undefined && !slotMetaFieldsEqual(before, after)) {
      out.push({ name, before, after });
    }
  }
  return out;
}

function buildMessageListWithOptionalSharing(params: {
  readonly incoming: readonly CompiledMessage[];
  readonly immutable: boolean;
  readonly previousSnapshot: ContextSnapshot | undefined;
  readonly structuralSharing: boolean;
}): CompiledMessage[] {
  const { incoming, immutable, previousSnapshot, structuralSharing } = params;
  if (
    !structuralSharing ||
    !immutable ||
    previousSnapshot === undefined ||
    !previousSnapshot.immutable
  ) {
    return incoming.map(cloneCompiledMessage);
  }
  const prev = previousSnapshot.messages;
  return incoming.map((m, i) => {
    const p = prev[i];
    if (p !== undefined && compiledMessageJson(m) === compiledMessageJson(p)) {
      return p as CompiledMessage;
    }
    return cloneCompiledMessage(m);
  });
}

/**
 * Immutable compiled context ready for LLM consumption (§6.4, §12.1).
 */
export class ContextSnapshot {
  readonly id: string;

  private readonly _messages: CompiledMessage[];

  readonly meta: SnapshotMeta;

  private readonly _model: string;

  readonly immutable: boolean;

  private readonly _providerAdapters: Partial<Record<ProviderId, ProviderAdapter>> | undefined;

  private static freezeMutableData(snap: ContextSnapshot): void {
    deepFreeze(snap._messages);
    for (const m of snap._messages) {
      deepFreeze(m);
      if (typeof m.content !== 'string') {
        deepFreeze(m.content);
      }
    }
    deepFreeze(snap.meta);
  }

  private constructor(init: {
    readonly id: string;
    readonly messages: CompiledMessage[];
    readonly meta: SnapshotMeta;
    readonly model: string;
    readonly immutable: boolean;
    readonly providerAdapters?: Partial<Record<ProviderId, ProviderAdapter>>;
  }) {
    this.id = init.id;
    this._messages = init.messages;
    this.meta = init.meta;
    this._model = init.model;
    this.immutable = init.immutable;
    this._providerAdapters = init.providerAdapters;
  }

  get messages(): readonly Readonly<CompiledMessage>[] {
    return this._messages as readonly Readonly<CompiledMessage>[];
  }

  /** Model id used when this snapshot was compiled (matches {@link SerializedSnapshot.model}). */
  get model(): string {
    return this._model;
  }

  /**
   * Builds a snapshot from orchestrator output.
   */
  static create(params: CreateContextSnapshotParams): ContextSnapshot {
    const immutable = params.immutable !== false;
    const structuralSharing =
      params.structuralSharing ??
      (params.previousSnapshot !== undefined ? true : false);
    const messageList = buildMessageListWithOptionalSharing({
      incoming: params.messages,
      immutable,
      previousSnapshot: params.previousSnapshot,
      structuralSharing,
    });
    const meta = { ...params.meta };
    const snap = new ContextSnapshot({
      id: params.id ?? createContentId(),
      messages: messageList,
      meta,
      model: params.model,
      immutable,
      ...(params.providerAdapters !== undefined
        ? { providerAdapters: params.providerAdapters }
        : {}),
    });
    if (immutable) {
      ContextSnapshot.freezeMutableData(snap);
    }
    return snap;
  }

  /**
   * Restores a snapshot from {@link SerializedSnapshot}, verifying SHA-256 checksum.
   *
   * Recomputes the digest over the canonical payload (`version`, `id`, `model`, `slots`, `messages`,
   * `meta` — `checksum` excluded) and rejects tampering (§12.1, §19.1 — serialized snapshot integrity).
   *
   * @throws {@link SnapshotCorruptedError} When shape is invalid or checksum mismatches.
   */
  static deserialize(
    data: unknown,
    options?: DeserializeContextSnapshotOptions,
  ): ContextSnapshot {
    if (data === null || typeof data !== 'object') {
      throw new SnapshotCorruptedError('deserialize: expected object', {
        context: { received: typeof data },
      });
    }
    const d = data as SerializedSnapshot;
    if (d.version !== '1.0') {
      throw new SnapshotCorruptedError(`deserialize: unsupported version "${String(d.version)}"`, {
        context: { version: d.version },
      });
    }
    if (
      typeof d.id !== 'string' ||
      typeof d.model !== 'string' ||
      typeof d.checksum !== 'string' ||
      !Array.isArray(d.messages) ||
      d.meta === null ||
      typeof d.meta !== 'object' ||
      d.slots === null ||
      typeof d.slots !== 'object'
    ) {
      throw new SnapshotCorruptedError('deserialize: invalid serialized snapshot shape', {
        context: { keys: Object.keys(d) },
      });
    }

    const messages = d.messages.map((m) => cloneCompiledMessage(m as CompiledMessage));
    const meta = { ...d.meta } as SnapshotMeta;
    const slotsCopy = { ...d.slots };
    const payload = snapshotV1PayloadString({
      id: d.id,
      model: d.model,
      slots: slotsCopy,
      messages,
      meta,
    });
    const expected = sha256HexUtf8(payload);
    if (expected !== d.checksum) {
      throw new SnapshotCorruptedError('deserialize: checksum mismatch', {
        context: { expected, received: d.checksum },
      });
    }

    const immutable = options?.immutable !== false;
    const snap = new ContextSnapshot({
      id: d.id,
      messages,
      meta,
      model: d.model,
      immutable,
      ...(options?.providerAdapters !== undefined
        ? { providerAdapters: options.providerAdapters }
        : {}),
    });
    if (immutable) {
      ContextSnapshot.freezeMutableData(snap);
    }
    return snap;
  }

  /**
   * Upgrades persisted snapshot JSON from a registered legacy `version` to {@link SerializedSnapshot}
   * `1.0`, then restores a {@link ContextSnapshot} (same verification as {@link ContextSnapshot.deserialize}).
   *
   * @throws {@link SnapshotCorruptedError} When no migration exists, the chain is invalid, or checksum fails.
   */
  static migrate(
    oldData: unknown,
    options?: DeserializeContextSnapshotOptions,
  ): ContextSnapshot {
    const wire = migrateSnapshotDataToSerializedV1(oldData);
    return ContextSnapshot.deserialize(wire, options);
  }

  format(target: SnapshotFormatTarget): unknown {
    const readonlyMsgs = this._messages as readonly CompiledMessage[];
    if (target === 'text') {
      return formatCompiledMessagesAsPlainText(readonlyMsgs);
    }
    const adapter = this._providerAdapters?.[target];
    if (adapter !== undefined) {
      return adapter.formatMessages(readonlyMsgs);
    }
    return readonlyMsgs.map(cloneCompiledMessage);
  }

  /**
   * Produces a JSON-serializable {@link SerializedSnapshot} with `version: '1.0'` and a
   * SHA-256 checksum over the payload (version, id, model, slots, messages, meta — checksum field excluded).
   */
  serialize(): SerializedSnapshot {
    const slotsCopy = { ...this.meta.slots };
    const messagesOut = this._messages.map(cloneCompiledMessage);
    return sealSerializedSnapshotV1({
      version: '1.0',
      id: this.id,
      model: this._model,
      slots: slotsCopy,
      messages: messagesOut,
      meta: this.meta,
    });
  }

  /**
   * Structural diff vs `other` (§12.1 — Phase 9.4): positional message changes plus
   * {@link SnapshotDiff.slotsModified} for {@link SlotMeta} drift on shared slot names.
   */
  diff(other: ContextSnapshot): SnapshotDiff {
    const added: CompiledMessage[] = [];
    const removed: CompiledMessage[] = [];
    const modified: Array<{
      index: number;
      before: Readonly<CompiledMessage>;
      after: Readonly<CompiledMessage>;
    }> = [];
    const a = this._messages;
    const b = other.messages as readonly CompiledMessage[];
    const min = Math.min(a.length, b.length);
    for (let i = 0; i < min; i++) {
      if (compiledMessageJson(a[i]!) !== compiledMessageJson(b[i]!)) {
        modified.push({
          index: i,
          before: a[i]!,
          after: b[i]!,
        });
      }
    }
    if (a.length > b.length) {
      for (let i = b.length; i < a.length; i++) {
        removed.push(a[i]!);
      }
    }
    if (b.length > a.length) {
      for (let i = a.length; i < b.length; i++) {
        added.push(b[i]!);
      }
    }
    const slotsModified = diffSlotMeta(this.meta.slots, other.meta.slots);
    return { added, removed, modified, slotsModified };
  }
}
