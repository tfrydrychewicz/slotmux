/**
 * {@link ContextSnapshot} class — immutability, SHA-256, deserialize, format, diff (§5.5).
 *
 * @packageDocumentation
 */

import { SnapshotCorruptedError } from '../errors.js';
import { createContentId } from '../types/branded.js';
import type { ProviderId } from '../types/config.js';
import type { CompiledMessage } from '../types/content.js';
import type { ProviderAdapter } from '../types/provider.js';
import type {
  SerializedSnapshot,
  SnapshotDiff,
  SnapshotMeta,
} from '../types/snapshot.js';

import { cloneCompiledMessage, compiledMessageJson } from './clone-compiled-message.js';
import { deepFreeze } from './deep-freeze.js';
import { sha256HexUtf8 } from './sha256-hex.js';

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

function snapshotPayloadString(params: {
  readonly version: SerializedSnapshot['version'];
  readonly id: string;
  readonly model: string;
  readonly slots: SerializedSnapshot['slots'];
  readonly messages: readonly CompiledMessage[];
  readonly meta: SnapshotMeta;
}): string {
  return JSON.stringify({
    version: params.version,
    id: params.id,
    model: params.model,
    slots: params.slots,
    messages: params.messages,
    meta: params.meta,
  });
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
    const payload = snapshotPayloadString({
      version: d.version,
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

  format(provider: ProviderId): unknown {
    const adapter = this._providerAdapters?.[provider];
    const readonlyMsgs = this._messages as readonly CompiledMessage[];
    if (adapter !== undefined) {
      return adapter.formatMessages(readonlyMsgs);
    }
    return readonlyMsgs.map(cloneCompiledMessage);
  }

  serialize(): SerializedSnapshot {
    const slotsCopy = { ...this.meta.slots };
    const messagesOut = this._messages.map(cloneCompiledMessage);
    const payload = snapshotPayloadString({
      version: '1.0',
      id: this.id,
      model: this._model,
      slots: slotsCopy,
      messages: messagesOut,
      meta: this.meta,
    });
    const checksum = sha256HexUtf8(payload);
    return {
      version: '1.0',
      id: this.id,
      model: this._model,
      slots: slotsCopy,
      messages: messagesOut,
      meta: this.meta,
      checksum,
    };
  }

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
    return { added, removed, modified };
  }
}
