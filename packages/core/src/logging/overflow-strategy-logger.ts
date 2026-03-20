/**
 * Adapts {@link Logger} to {@link OverflowStrategyLogger} for {@link OverflowEngine} (§13.3 — Phase 10.1).
 *
 * @packageDocumentation
 */

import type { OverflowStrategyLogger } from '../types/config.js';

import type { Logger } from './logger.js';

/** Maps full {@link Logger} to the shape passed on {@link OverflowContext.logger}. */
export function overflowStrategyLoggerFromLogger(log: Logger): OverflowStrategyLogger {
  return {
    trace: (message, ...args) => {
      log.trace(message, ...args);
    },
    debug: (message, ...args) => {
      log.debug(message, ...args);
    },
    info: (message, ...args) => {
      log.info(message, ...args);
    },
    warn: (message, ...args) => {
      log.warn(message, ...args);
    },
    error: (message, ...args) => {
      log.error(message, ...args);
    },
  };
}
