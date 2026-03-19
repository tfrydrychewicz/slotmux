/**
 * Fluent {@link ContextBuilder} for model config + slots + messages (§6.5 — Phase 5.2).
 *
 * @packageDocumentation
 */

import type { ContextPresetId } from '../config/presets.js';
import {
  validateContextConfig,
  validateSlotConfig,
  type ParsedContextConfig,
} from '../config/validator.js';
import { InvalidConfigError } from '../errors.js';
import type { ContextConfig, ModelId, SlotConfig } from '../types/config.js';
import type { MultimodalContent } from '../types/content.js';
import type { ContextEvent } from '../types/events.js';

import type { ContextBuildParams } from './build-overrides.js';
import type { ContextOrchestratorBuildResult } from './context-orchestrator.js';
import { Context, type ContextPushItemInput } from './context.js';
import { resolveContextSlots } from './create-context.js';

type BuilderOp =
  | { readonly kind: 'system'; readonly content: string | readonly MultimodalContent[] }
  | { readonly kind: 'user'; readonly content: string | readonly MultimodalContent[] }
  | { readonly kind: 'assistant'; readonly content: string | readonly MultimodalContent[] }
  | {
      readonly kind: 'push';
      readonly slot: string;
      readonly payload:
        | string
        | readonly MultimodalContent[]
        | readonly ContextPushItemInput[];
    };

/**
 * Chainable builder: `.model()` / `.reserve()` / `.slot()` then `.system()` / `.user()` /
 * `.assistant()` / `.push()` and {@link ContextBuilder.build}.
 */
export class ContextBuilder {
  private _model: ModelId | undefined;

  private _reserve: number | undefined;

  private _preset: ContextPresetId | undefined;

  private readonly _slotOverrides: Record<string, SlotConfig> = {};

  private _onEvent: ((event: ContextEvent) => void) | undefined;

  private readonly _ops: BuilderOp[] = [];

  /** Set the model id (required before {@link ContextBuilder.build}). */
  model(id: ModelId): this {
    this._model = id;
    return this;
  }

  /**
   * Tokens reserved for the model response (maps to `reserveForResponse` on {@link ContextConfig}).
   */
  reserve(tokens: number): this {
    if (!Number.isInteger(tokens) || tokens < 0) {
      throw new InvalidConfigError('reserve(tokens) expects a non-negative integer', {
        context: { tokens },
      });
    }
    this._reserve = tokens;
    return this;
  }

  /**
   * Default slot layout preset when using `.slot()` overrides (see {@link resolveContextSlots}).
   */
  preset(id: ContextPresetId): this {
    this._preset = id;
    return this;
  }

  /**
   * Register or override a slot configuration (validated with Zod).
   */
  slot(name: string, config: unknown): this {
    const parsed = validateSlotConfig(config);
    this._slotOverrides[name] = parsed as SlotConfig;
    return this;
  }

  /** Observability — merged into validated config and forwarded to {@link Context}. */
  onEvent(handler: (event: ContextEvent) => void): this {
    const prev = this._onEvent;
    this._onEvent = prev
      ? (e) => {
          prev(e);
          handler(e);
        }
      : handler;
    return this;
  }

  system(content: string | readonly MultimodalContent[]): this {
    this._ops.push({ kind: 'system', content });
    return this;
  }

  user(content: string | readonly MultimodalContent[]): this {
    this._ops.push({ kind: 'user', content });
    return this;
  }

  assistant(content: string | readonly MultimodalContent[]): this {
    this._ops.push({ kind: 'assistant', content });
    return this;
  }

  push(
    slotName: string,
    payload: string | readonly MultimodalContent[] | readonly ContextPushItemInput[],
  ): this {
    this._ops.push({ kind: 'push', slot: slotName, payload });
    return this;
  }

  private toSlotsRecord(): Record<string, SlotConfig> {
    const resolveOpts: { preset?: ContextPresetId; slots?: Record<string, SlotConfig> } =
      {};
    if (this._preset !== undefined) {
      resolveOpts.preset = this._preset;
    }
    if (Object.keys(this._slotOverrides).length > 0) {
      resolveOpts.slots = { ...this._slotOverrides };
    }
    return resolveContextSlots(resolveOpts);
  }

  private toContextConfig(): ContextConfig {
    if (this._model === undefined || String(this._model).trim() === '') {
      throw new InvalidConfigError('Call .model(id) before .build()', {
        context: { phase: '5.2' },
      });
    }

    const slots = this.toSlotsRecord();
    return {
      model: this._model,
      slots: slots as Record<string, SlotConfig>,
      ...(this._reserve !== undefined ? { reserveForResponse: this._reserve } : {}),
      ...(this._onEvent !== undefined
        ? { onEvent: this._onEvent as NonNullable<ContextConfig['onEvent']> }
        : {}),
    };
  }

  private applyOps(ctx: Context): void {
    for (const op of this._ops) {
      switch (op.kind) {
        case 'system': {
          ctx.system(op.content);
          break;
        }
        case 'user': {
          ctx.user(op.content);
          break;
        }
        case 'assistant': {
          ctx.assistant(op.content);
          break;
        }
        case 'push': {
          ctx.push(op.slot, op.payload);
          break;
        }
      }
    }
  }

  /**
   * Validates config, materializes {@link Context}, runs {@link Context.build} / orchestrator.
   */
  async build(params?: ContextBuildParams): Promise<ContextOrchestratorBuildResult> {
    const parsed: ParsedContextConfig = validateContextConfig(this.toContextConfig());
    const context = Context.fromParsedConfig(parsed);
    this.applyOps(context);
    return context.build(params);
  }
}

/**
 * Starts a fluent {@link ContextBuilder} chain.
 *
 * @example
 * ```ts
 * const { snapshot } = await contextBuilder()
 *   .model('gpt-4o')
 *   .preset('chat')
 *   .system('You are helpful')
 *   .user('Hello')
 *   .build();
 * ```
 */
export function contextBuilder(): ContextBuilder {
  return new ContextBuilder();
}
