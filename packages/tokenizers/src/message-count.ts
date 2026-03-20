/**
 * Compiled-message token totals using the `TOKEN_OVERHEAD` registry (§9.4).
 *
 * @packageDocumentation
 */

import {
  type CompiledMessage,
  TOKEN_OVERHEAD,
  type ProviderTokenOverhead,
} from 'slotmux';

import { compiledMessageToEstimationString } from './compiled-message-string.js';

const OPENAI_DEFAULT = TOKEN_OVERHEAD.openai;

/**
 * OpenAI registry values (backward compatible with pre–2.4 exports).
 * @deprecated Prefer {@link TOKEN_OVERHEAD.openai}
 */
export const PER_MESSAGE_OVERHEAD_TOKENS = OPENAI_DEFAULT.perMessage;

/** @deprecated Prefer {@link TOKEN_OVERHEAD.openai} */
export const PER_CONVERSATION_OVERHEAD_TOKENS = OPENAI_DEFAULT.perConversation;

function nameFieldOverhead(message: CompiledMessage, perName: number): number {
  if (perName === 0) {
    return 0;
  }
  return message.name !== undefined && message.name !== '' ? perName : 0;
}

/**
 * Token units for one compiled message: BPE length of the estimation string + per-message overhead
 * + optional {@link CompiledMessage.name} overhead.
 */
export function compiledMessageTokenUnits(
  countStringTokens: (s: string) => number,
  message: CompiledMessage,
  overhead: ProviderTokenOverhead = OPENAI_DEFAULT,
): number {
  return (
    countStringTokens(compiledMessageToEstimationString(message)) +
    overhead.perMessage +
    nameFieldOverhead(message, overhead.perName)
  );
}

/**
 * Total token units for a message list, including conversation overhead when non-empty.
 */
export function countCompiledMessages(
  countStringTokens: (s: string) => number,
  messages: CompiledMessage[],
  overhead: ProviderTokenOverhead = OPENAI_DEFAULT,
): number {
  if (messages.length === 0) {
    return 0;
  }
  let sum = overhead.perConversation;
  for (const m of messages) {
    sum += compiledMessageTokenUnits(countStringTokens, m, overhead);
  }
  return sum;
}
