/**
 * Plain-text rendering of compiled messages for {@link ContextSnapshot.format}('text') (§6.4 / Phase 6.8).
 *
 * @packageDocumentation
 */

import type {
  CompiledContentPart,
  CompiledMessage,
} from '../types/content.js';

function compiledPartToPlain(part: CompiledContentPart): string {
  switch (part.type) {
    case 'text':
      return part.text;
    case 'image_url':
      return '[image]';
    case 'image_base64':
      return '[image]';
    default: {
      const _exhaustive: never = part;
      return _exhaustive;
    }
  }
}

/**
 * Extracts human-readable text from one compiled message (text parts, `[image]` placeholders, JSON tool calls).
 */
export function compiledMessageToPlainText(message: Readonly<CompiledMessage>): string {
  const textParts: string[] = [];

  if (typeof message.content === 'string') {
    if (message.content.length > 0) {
      textParts.push(message.content);
    }
  } else {
    for (const part of message.content) {
      const p = compiledPartToPlain(part);
      if (p.length > 0) {
        textParts.push(p);
      }
    }
  }

  const textBlock = textParts.join('\n');
  const toolBlock =
    message.toolUses !== undefined && message.toolUses.length > 0
      ? JSON.stringify(message.toolUses)
      : '';

  if (textBlock.length > 0 && toolBlock.length > 0) {
    return `${textBlock}\n${toolBlock}`;
  }
  if (toolBlock.length > 0) {
    return toolBlock;
  }
  return textBlock;
}

/**
 * Concatenates all messages into one plain string, separated by blank lines.
 */
export function formatCompiledMessagesAsPlainText(
  messages: readonly Readonly<CompiledMessage>[],
): string {
  return messages
    .map((m) => compiledMessageToPlainText(m))
    .filter((s) => s.length > 0)
    .join('\n\n');
}
