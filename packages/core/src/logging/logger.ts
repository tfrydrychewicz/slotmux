/**
 * Structured logging: levels, console sink, scoping, redaction (§13.3).
 *
 * @packageDocumentation
 */

import {
  DEFAULT_REDACTION_PATTERNS,
  type RedactionOptions,
  redactString,
  redactUnknown,
} from './redact.js';

// ==========================================
// Log level
// ==========================================

/**
 * Syslog-style numeric severity: lower = more severe.
 * A configured level shows that severity and **more severe** (lower number) messages.
 * Example: {@link LogLevel.INFO} shows ERROR, WARN, and INFO, but not DEBUG.
 */
export enum LogLevel {
  SILENT = -1,
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  /** Most verbose; at this level, redaction is disabled for logs/events when it would otherwise apply (§19.2). */
  TRACE = 4,
}

function shouldEmit(configured: LogLevel, messageLevel: LogLevel): boolean {
  if (configured === LogLevel.SILENT) {
    return false;
  }
  return messageLevel <= configured;
}

// ==========================================
// Logger interface
// ==========================================

/**
 * Application / library logger (§13.3).
 */
export interface Logger {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export type ConsoleLoggerOptions = {
  /**
   * Prepended to every message, e.g. `[slotmux]`.
   * When omitted, only `message` is passed through.
   */
  readonly prefix?: string;
};

/**
 * Delegates to `console` methods (browser or Node).
 */
export function createConsoleLogger(options?: ConsoleLoggerOptions): Logger {
  const prefix = options?.prefix;
  const fmt = (message: string): string =>
    prefix !== undefined ? `${prefix} ${message}` : message;

  return {
    trace: (message, ...args) => {
      console.debug(fmt(`[trace] ${message}`), ...args);
    },
    debug: (message, ...args) => {
      console.debug(fmt(message), ...args);
    },
    info: (message, ...args) => {
      console.info(fmt(message), ...args);
    },
    warn: (message, ...args) => {
      console.warn(fmt(message), ...args);
    },
    error: (message, ...args) => {
      console.error(fmt(message), ...args);
    },
  };
}

/** No-op sink — default when no {@link ContextConfig.logger} is set. */
export const noopLogger: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Drops log calls below `minLevel`. {@link LogLevel.SILENT} silences everything.
 */
export function createLeveledLogger(delegate: Logger, configured: LogLevel): Logger {
  if (configured === LogLevel.SILENT) {
    return noopLogger;
  }

  return {
    trace: (message, ...args) => {
      if (shouldEmit(configured, LogLevel.TRACE)) {
        delegate.trace(message, ...args);
      }
    },
    debug: (message, ...args) => {
      if (shouldEmit(configured, LogLevel.DEBUG)) {
        delegate.debug(message, ...args);
      }
    },
    info: (message, ...args) => {
      if (shouldEmit(configured, LogLevel.INFO)) {
        delegate.info(message, ...args);
      }
    },
    warn: (message, ...args) => {
      if (shouldEmit(configured, LogLevel.WARN)) {
        delegate.warn(message, ...args);
      }
    },
    error: (message, ...args) => {
      if (shouldEmit(configured, LogLevel.ERROR)) {
        delegate.error(message, ...args);
      }
    },
  };
}

/**
 * Prefixes messages with `[slotmux:${scope}]` (plugin / subsystem label).
 */
export function createScopedLogger(delegate: Logger, scope: string): Logger {
  const p = `[slotmux:${scope}]`;
  const fmt = (message: string): string => `${p} ${message}`;

  return {
    trace: (message, ...args) => delegate.trace(fmt(message), ...args),
    debug: (message, ...args) => delegate.debug(fmt(message), ...args),
    info: (message, ...args) => delegate.info(fmt(message), ...args),
    warn: (message, ...args) => delegate.warn(fmt(message), ...args),
    error: (message, ...args) => delegate.error(fmt(message), ...args),
  };
}

/**
 * Fields prepended to each message as `[op=… slot=…]` for pipeline / overflow tracing (§13.3).
 * Omitted keys are not shown.
 */
export type LogContextFields = {
  readonly operationId?: string;
  readonly slot?: string;
};

function formatLogContextPrefix(fields: LogContextFields): string {
  const parts: string[] = [];
  if (fields.operationId !== undefined && fields.operationId !== '') {
    parts.push(`op=${fields.operationId}`);
  }
  if (fields.slot !== undefined && fields.slot !== '') {
    parts.push(`slot=${fields.slot}`);
  }
  if (parts.length === 0) {
    return '';
  }
  return `[${parts.join(' ')}] `;
}

/**
 * Wraps a {@link Logger} so every message is prefixed with {@link LogContextFields} (build operation id, slot name).
 * When no fields are set, returns `delegate` unchanged.
 */
export function createContextualLogger(delegate: Logger, fields: LogContextFields): Logger {
  const prefix = formatLogContextPrefix(fields);
  if (prefix === '') {
    return delegate;
  }
  const fmt = (message: string): string => `${prefix}${message}`;

  return {
    trace: (message, ...args) => delegate.trace(fmt(message), ...args),
    debug: (message, ...args) => delegate.debug(fmt(message), ...args),
    info: (message, ...args) => delegate.info(fmt(message), ...args),
    warn: (message, ...args) => delegate.warn(fmt(message), ...args),
    error: (message, ...args) => delegate.error(fmt(message), ...args),
  };
}

/**
 * Best-effort unique id for a single {@link Context.build} / orchestrator run (UUID when `crypto.randomUUID` exists).
 */
export function newBuildOperationId(): string {
  const c = globalThis as typeof globalThis & {
    crypto?: { randomUUID?: () => string };
  };
  if (c.crypto?.randomUUID !== undefined) {
    return c.crypto.randomUUID();
  }
  return `build-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export type RedactingLoggerOptions = {
  readonly delegate: Logger;
  /**
   * When `true`, uses {@link DEFAULT_REDACTION_PATTERNS} from `./redact.js`.
   * When an object, uses its `patterns` / `replacement`.
   */
  readonly redaction: RedactionOptions | true;
};

/**
 * Redacts the message string and any `unknown` args (deep object walk) before forwarding.
 */
export function createRedactingLogger(options: RedactingLoggerOptions): Logger {
  const { delegate } = options;
  const ropts: RedactionOptions =
    options.redaction === true
      ? { patterns: [...DEFAULT_REDACTION_PATTERNS] }
      : options.redaction;

  const redactArgs = (args: unknown[]): unknown[] =>
    args.map((a) => redactUnknown(a, ropts));

  return {
    trace: (message, ...args) => {
      delegate.trace(redactString(message, ropts.patterns, ropts.replacement), ...redactArgs(args));
    },
    debug: (message, ...args) => {
      delegate.debug(redactString(message, ropts.patterns, ropts.replacement), ...redactArgs(args));
    },
    info: (message, ...args) => {
      delegate.info(redactString(message, ropts.patterns, ropts.replacement), ...redactArgs(args));
    },
    warn: (message, ...args) => {
      delegate.warn(redactString(message, ropts.patterns, ropts.replacement), ...redactArgs(args));
    },
    error: (message, ...args) => {
      delegate.error(redactString(message, ropts.patterns, ropts.replacement), ...redactArgs(args));
    },
  };
}

export type PluginLoggerFactoryOptions = {
  /** Default {@link LogLevel.INFO}. */
  readonly level?: LogLevel;
  /** Passed to {@link createConsoleLogger} (default `[slotmux]`). */
  readonly consolePrefix?: string;
  /** When set, applies {@link createRedactingLogger} before scoping. */
  readonly redaction?: RedactionOptions | true;
};

/**
 * Returns a factory suitable for {@link PluginManagerOptions.createLogger}:
 * `[slotmux:pluginName]` prefix, optional level filter and redaction.
 */
export function createPluginLoggerFactory(
  options?: PluginLoggerFactoryOptions,
): (pluginName: string) => Logger {
  const level = options?.level ?? LogLevel.INFO;
  const consolePrefix = options?.consolePrefix ?? '[slotmux]';

  return (pluginName: string) => {
    let base: Logger = createConsoleLogger({ prefix: consolePrefix });
    base = createLeveledLogger(base, level);
    if (options?.redaction !== undefined) {
      base = createRedactingLogger({ delegate: base, redaction: options.redaction });
    }
    return createScopedLogger(base, pluginName);
  };
}
