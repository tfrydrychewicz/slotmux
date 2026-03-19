/**
 * Mutable runtime context container — slots, content, and events (§6.1, §6.3 — Phase 5.1).
 *
 * @packageDocumentation
 */

import type { ParsedContextConfig } from '../config/validator.js';
import {
  ContentStore,
  createContentItem,
  type CreateContentItemParams,
} from '../content/content-store.js';
import { InvalidConfigError } from '../errors.js';
import type { ContentId } from '../types/branded.js';
import type { SlotConfig } from '../types/config.js';
import type { ContentItem, MessageRole, MultimodalContent } from '../types/content.js';
import type { ContextEvent } from '../types/events.js';

import {
  mergeParsedConfigForBuild,
  type ContextBuildParams,
} from './build-overrides.js';
import { ContextOrchestrator, type ContextOrchestratorBuildResult } from './context-orchestrator.js';

/** Default slot for {@link Context.system}. */
export const DEFAULT_SYSTEM_SLOT = 'system';

/** Default slot for {@link Context.user} / {@link Context.assistant}. */
export const DEFAULT_HISTORY_SLOT = 'history';

/**
 * One row for {@link Context.push} batch insertion — same fields as {@link CreateContentItemParams}
 * except `slot` is taken from the `push` call and `role` defaults to the slot’s {@link SlotConfig.defaultRole}.
 */
export type ContextPushItemInput = Omit<CreateContentItemParams, 'slot' | 'role'> & {
  role?: MessageRole;
};

export type ContextInit = {
  /** Slot layout (e.g. from {@link ParsedContextConfig.slots}). */
  readonly slots: Record<string, SlotConfig>;

  /** Optional observability hook — receives {@link ContextEvent} instances. */
  readonly onEvent?: (event: ContextEvent) => void;

  /** Override default `'system'` target for {@link Context.system}. */
  readonly systemSlotName?: string;

  /** Override default `'history'` target for {@link Context.user} / {@link Context.assistant}. */
  readonly historySlotName?: string;

  /**
   * Full validated config — enables {@link Context.build}. Set by {@link Context.fromParsedConfig}.
   */
  readonly parsedConfig?: ParsedContextConfig;
};

function shallowItemCopy(item: ContentItem): ContentItem {
  return { ...item };
}

/**
 * Refine batch detection: rows are push inputs if they declare `content` (batch row shape).
 * Plain multimodal blocks use `type` + `text` / image fields without a `content` property.
 */
function isBatchRows(
  value: readonly unknown[],
): value is readonly ContextPushItemInput[] {
  if (value.length === 0) {
    return false;
  }
  const first = value[0];
  if (typeof first !== 'object' || first === null) {
    return false;
  }
  return 'content' in first;
}

function resolveContentRef(
  itemOrId: ContentItem | Pick<ContentItem, 'id'> | ContentId,
): ContentId {
  if (typeof itemOrId === 'string') {
    return itemOrId as ContentId;
  }
  return itemOrId.id;
}

/**
 * Main mutable context: append messages, pin / mark ephemeral, emit lifecycle events.
 */
export class Context {
  private readonly store: ContentStore;

  private readonly onEvent: ((event: ContextEvent) => void) | undefined;

  private readonly systemSlot: string;

  private readonly historySlot: string;

  private readonly slotConfigs: Readonly<Record<string, SlotConfig>>;

  private readonly parsedConfig: ParsedContextConfig | undefined;

  constructor(init: ContextInit) {
    const keys = Object.keys(init.slots);
    if (keys.length === 0) {
      throw new InvalidConfigError('Context requires at least one slot in `slots`', {
        context: { phase: '5.1' },
      });
    }
    const slots = init.slots as Record<string, SlotConfig>;
    this.slotConfigs = slots;
    this.store = new ContentStore({ ...slots });
    this.onEvent = init.onEvent;
    this.systemSlot = init.systemSlotName ?? DEFAULT_SYSTEM_SLOT;
    this.historySlot = init.historySlotName ?? DEFAULT_HISTORY_SLOT;
    this.parsedConfig = init.parsedConfig;
  }

  /**
   * Builds a {@link Context} from a validated config (uses `slots` and optional `onEvent`).
   *
   * @throws {@link InvalidConfigError} If `config.slots` is missing or empty
   */
  static fromParsedConfig(config: ParsedContextConfig): Context {
    const slots = config.slots;
    if (slots === undefined || Object.keys(slots).length === 0) {
      throw new InvalidConfigError(
        '`ParsedContextConfig.slots` must be a non-empty record for Context',
        { context: { phase: '5.1' } },
      );
    }
    return new Context({
      slots: slots as Record<string, SlotConfig>,
      parsedConfig: config,
      ...(config.onEvent !== undefined
        ? { onEvent: config.onEvent as (event: ContextEvent) => void }
        : {}),
    });
  }

  /**
   * Runs the compile pipeline using the config from {@link Context.fromParsedConfig},
   * optionally with temporary `reserve` / `maxTokens` / per-slot overrides (§5.6).
   * Does not mutate the stored parsed config or {@link Context} slot layout.
   *
   * @throws {@link InvalidConfigError} If this context was not created with {@link Context.fromParsedConfig}
   */
  async build(params?: ContextBuildParams): Promise<ContextOrchestratorBuildResult> {
    if (this.parsedConfig === undefined) {
      throw new InvalidConfigError(
        'Context.build() requires Context.fromParsedConfig() so model, maxTokens, and full config are available',
        { context: { phase: '5.6' } },
      );
    }

    const effective = mergeParsedConfigForBuild(this.parsedConfig, params?.overrides);

    return ContextOrchestrator.build({
      config: effective,
      context: this,
      ...(params?.providerAdapters !== undefined
        ? { providerAdapters: params.providerAdapters }
        : {}),
      ...(params?.previousSnapshot !== undefined
        ? { previousSnapshot: params.previousSnapshot }
        : {}),
      ...(params?.structuralSharing !== undefined
        ? { structuralSharing: params.structuralSharing }
        : {}),
    });
  }

  /** Shallow copy of items in `slot` (insertion order). */
  getItems(slot: string): ContentItem[] {
    return this.store.getItems(slot);
  }

  /** Registered slot names from the initial layout. */
  get registeredSlots(): string[] {
    return this.store.registeredSlots;
  }

  private defaultRoleFor(slot: string): MessageRole {
    return this.slotConfigs[slot]?.defaultRole ?? 'user';
  }

  private emitContentAdded(slot: string, item: ContentItem): void {
    this.onEvent?.({
      type: 'content:added',
      slot,
      item: shallowItemCopy(item),
    });
  }

  private appendOne(params: CreateContentItemParams): void {
    const item = createContentItem(params);
    this.store.addItem(params.slot, item);
    this.emitContentAdded(params.slot, item);
  }

  /**
   * Adds a system message to the configured system slot (default `'system'`).
   */
  system(content: string | readonly MultimodalContent[]): void {
    this.appendOne({
      slot: this.systemSlot,
      role: 'system',
      content: content as ContentItem['content'],
    });
  }

  /**
   * Adds a user message to the configured history slot (default `'history'`).
   */
  user(content: string | readonly MultimodalContent[]): void {
    this.appendOne({
      slot: this.historySlot,
      role: 'user',
      content: content as ContentItem['content'],
    });
  }

  /**
   * Adds an assistant message to the configured history slot (default `'history'`).
   */
  assistant(content: string | readonly MultimodalContent[]): void {
    this.appendOne({
      slot: this.historySlot,
      role: 'assistant',
      content: content as ContentItem['content'],
    });
  }

  /**
   * Appends one message (string or multimodal blocks) using the slot’s {@link SlotConfig.defaultRole},
   * or appends many rows with per-row metadata (batch §6.3).
   */
  push(
    slot: string,
    payload: string | readonly MultimodalContent[] | readonly ContextPushItemInput[],
  ): void {
    if (typeof payload === 'string') {
      this.appendOne({
        slot,
        role: this.defaultRoleFor(slot),
        content: payload,
      });
      return;
    }

    if (!Array.isArray(payload)) {
      throw new InvalidConfigError('push(slot, payload): payload must be string, multimodal array, or batch rows', {
        context: { slot },
      });
    }

    if (payload.length === 0) {
      return;
    }

    if (isBatchRows(payload)) {
      for (const row of payload) {
        const role = row.role ?? this.defaultRoleFor(slot);
        this.appendOne({
          slot,
          role,
          content: row.content,
          metadata: row.metadata,
          pinned: row.pinned,
          ephemeral: row.ephemeral,
          tokens: row.tokens,
          summarizes: row.summarizes,
          id: row.id,
          createdAt: row.createdAt,
        });
      }
      return;
    }

    this.appendOne({
      slot,
      role: this.defaultRoleFor(slot),
      content: payload as MultimodalContent[],
    });
  }

  /**
   * Marks an existing item as pinned (overflow-resistant). Emits {@link ContextEvent} `content:pinned`.
   */
  pin(
    slot: string,
    itemOrId: ContentItem | Pick<ContentItem, 'id'> | ContentId,
  ): void {
    const id = resolveContentRef(itemOrId);
    this.store.pinItem(slot, id);
    const item = this.store.getItem(slot, id);
    this.onEvent?.({
      type: 'content:pinned',
      slot,
      item: shallowItemCopy(item),
    });
  }

  /**
   * Marks an existing item as ephemeral (cleared on next `ContentStore.clearEphemeral` / build pipeline).
   */
  ephemeral(
    slot: string,
    itemOrId: ContentItem | Pick<ContentItem, 'id'> | ContentId,
  ): void {
    const id = resolveContentRef(itemOrId);
    this.store.markItemEphemeral(slot, id);
  }

  /**
   * Delegates to {@link ContentStore.clearEphemeral} (e.g. between builds).
   */
  clearEphemeral(): void {
    this.store.clearEphemeral();
  }
}
