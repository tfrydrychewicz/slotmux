/**
 * Serialize {@link CompiledMessage} to a single string for token estimation (§9.2 / §9.4).
 *
 * @packageDocumentation
 */

import type {
  CompiledContentPart,
  CompiledMessage,
} from 'slotmux';

function compiledPartsToString(parts: CompiledContentPart[]): string {
  let s = '';
  for (const p of parts) {
    switch (p.type) {
      case 'text': {
        s += p.text;
        break;
      }
      case 'image_url': {
        s += p.image_url.url;
        break;
      }
      case 'image_base64': {
        s += p.image_base64.data;
        break;
      }
      default: {
        break;
      }
    }
  }
  return s;
}

function messageBodyToString(content: CompiledMessage['content']): string {
  return typeof content === 'string' ? content : compiledPartsToString(content);
}

/**
 * Serialize a compiled message into one string for BPE / length-based counting.
 * Not identical to any one provider’s wire format — pair with `TOKEN_OVERHEAD` for §9.4 totals.
 */
export function compiledMessageToEstimationString(message: CompiledMessage): string {
  const nameLine = message.name !== undefined ? `${message.name}\n` : '';
  return `${message.role}\n${nameLine}${messageBodyToString(message.content)}`;
}
