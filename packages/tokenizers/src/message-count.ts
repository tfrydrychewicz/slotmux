/**
 * Shared per-message / conversation token overhead (§9.4 preview — aligned with CharEstimatorTokenizer).
 *
 * @packageDocumentation
 */

import type { CompiledMessage } from 'contextcraft';

import { compiledMessageToEstimationString } from './char-estimator.js';

/** Formatting overhead applied once per compiled message (ChatML-style placeholder). */
export const PER_MESSAGE_OVERHEAD_TOKENS = 4;

/** Conversation-level overhead when {@link countCompiledMessages} sees ≥1 message. */
export const PER_CONVERSATION_OVERHEAD_TOKENS = 2;

/**
 * Token units for one compiled message: BPE length of the estimation string + per-message overhead.
 */
export function compiledMessageTokenUnits(
  countStringTokens: (s: string) => number,
  message: CompiledMessage,
): number {
  return (
    countStringTokens(compiledMessageToEstimationString(message)) +
    PER_MESSAGE_OVERHEAD_TOKENS
  );
}

/**
 * Total token units for a message list, including a single conversation overhead when non-empty.
 */
export function countCompiledMessages(
  countStringTokens: (s: string) => number,
  messages: CompiledMessage[],
): number {
  if (messages.length === 0) {
    return 0;
  }
  let sum = PER_CONVERSATION_OVERHEAD_TOKENS;
  for (const m of messages) {
    sum += compiledMessageTokenUnits(countStringTokens, m);
  }
  return sum;
}
