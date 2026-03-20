/**
 * Configurable PII redaction for logs and observability events (§19.2 — Phase 10.2).
 *
 * @packageDocumentation
 */

import { cloneCompiledMessage } from '../snapshot/clone-compiled-message.js';
import { ContextSnapshot } from '../snapshot/context-snapshot.js';
import type { CompiledMessage } from '../types/content.js';
import type { ContextEvent } from '../types/events.js';
import type { SnapshotMeta } from '../types/snapshot.js';

import type { LogLevel } from './logger.js';
import { LogLevel as LogLevelConst } from './logger.js';
import {
  DEFAULT_REDACTION_PATTERNS,
  type RedactionOptions,
  redactString as redactStringImpl,
  redactUnknown as redactUnknownImpl,
} from './redact.js';

export type RedactionEngineOptions = {
  readonly patterns: readonly RegExp[];
  readonly replacement?: string;
};

/**
 * Redaction with configurable patterns; defaults match {@link DEFAULT_REDACTION_PATTERNS}.
 */
export class RedactionEngine {
  private readonly patterns: readonly RegExp[];

  private readonly replacement: string;

  constructor(options?: Partial<RedactionEngineOptions>) {
    this.patterns = options?.patterns ?? [...DEFAULT_REDACTION_PATTERNS];
    this.replacement = options?.replacement ?? '[REDACTED]';
  }

  /** Engine using built-in SSN, email, and card-style patterns. */
  static defaultEngine(): RedactionEngine {
    return new RedactionEngine();
  }

  /** From `ContextConfig.redaction`: `true` → defaults; object → custom patterns. */
  static fromConfig(redaction: true | RedactionOptions): RedactionEngine {
    if (redaction === true) {
      return RedactionEngine.defaultEngine();
    }
    return new RedactionEngine({
      patterns: redaction.patterns,
      ...(redaction.replacement !== undefined ? { replacement: redaction.replacement } : {}),
    });
  }

  private asOptions(): RedactionOptions {
    return { patterns: this.patterns, replacement: this.replacement };
  }

  redactString(text: string): string {
    return redactStringImpl(text, this.patterns, this.replacement);
  }

  redactUnknown(value: unknown): unknown {
    return redactUnknownImpl(value, this.asOptions());
  }
}

export type ObservabilityRedactionConfig = {
  readonly redaction?: true | RedactionOptions | undefined;
  readonly logLevel?: LogLevel | undefined;
};

/** When `redaction` is set and log level is not {@link LogLevelConst.TRACE}, redact logs and events. */
export function shouldRedactObservability(config: ObservabilityRedactionConfig): boolean {
  if (config.redaction === undefined) {
    return false;
  }
  if (config.logLevel === LogLevelConst.TRACE) {
    return false;
  }
  return true;
}

export function createContextEventRedactor(
  config: ObservabilityRedactionConfig,
): ((event: ContextEvent) => ContextEvent) | undefined {
  if (!shouldRedactObservability(config)) {
    return undefined;
  }
  const raw = config.redaction;
  if (raw === undefined) {
    return undefined;
  }
  const engine = RedactionEngine.fromConfig(raw === true ? true : raw);
  return (event) => redactContextEvent(event, engine);
}

function cloneForRedaction<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function redactContentItemLike(value: unknown, engine: RedactionEngine): unknown {
  return engine.redactUnknown(cloneForRedaction(value));
}

function redactCompiledMessage(msg: Readonly<CompiledMessage>, engine: RedactionEngine): CompiledMessage {
  const cloned = cloneCompiledMessage(msg as CompiledMessage);
  return engine.redactUnknown(cloned) as CompiledMessage;
}

function redactSnapshotMeta(meta: Readonly<SnapshotMeta>, engine: RedactionEngine): SnapshotMeta {
  const cloned = cloneForRedaction(meta);
  return engine.redactUnknown(cloned) as SnapshotMeta;
}

/**
 * Returns a **new** event object with string leaves redacted. Does not mutate the original.
 * For `build:complete`, produces a new {@link ContextSnapshot} with redacted messages/meta (not the live snapshot).
 */
export function redactContextEvent(event: ContextEvent, engine: RedactionEngine): ContextEvent {
  switch (event.type) {
    case 'content:added':
    case 'content:evicted':
    case 'content:pinned':
      return {
        ...event,
        item: redactContentItemLike(event.item, engine) as (typeof event)['item'],
      };
    case 'warning':
      return {
        ...event,
        warning: engine.redactUnknown(cloneForRedaction(event.warning)) as typeof event.warning,
      };
    case 'build:complete': {
      const snap = event.snapshot;
      const messages = snap.messages.map((m) => redactCompiledMessage(m, engine));
      const meta = redactSnapshotMeta(snap.meta, engine);
      const redactedSnapshot = ContextSnapshot.create({
        id: snap.id,
        messages,
        meta,
        model: snap.model,
        immutable: false,
      });
      return { type: 'build:complete', snapshot: redactedSnapshot };
    }
    default:
      return event;
  }
}
