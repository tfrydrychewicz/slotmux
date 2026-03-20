/**
 * Ollama `/api/chat` message adapter (§10).
 *
 * @see https://github.com/ollama/ollama/blob/main/docs/api.md
 *
 * @packageDocumentation
 */

import {
  Cl100kTokenizer,
  FallbackTokenizer,
} from '@slotmux/tokenizers';
import {
  BaseProviderAdapter,
  type CompiledContentPart,
  type CompiledMessage,
  type ModelId,
  type Tokenizer,
} from 'slotmux';

/** Tool call shape Ollama expects on `assistant` messages. */
export type OllamaToolCall = {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
};

/**
 * `messages` entry for `POST /api/chat` (excluding top-level `model`, `stream`, etc.).
 */
export type OllamaChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; images?: string[] }
  | {
      role: 'assistant';
      content: string;
      tool_calls?: OllamaToolCall[];
    }
  | { role: 'tool'; content: string; tool_name: string };

function flattenTextContent(content: string | CompiledContentPart[]): string {
  if (typeof content === 'string') {
    return content;
  }
  const chunks: string[] = [];
  for (const p of content) {
    if (p.type === 'text') {
      chunks.push(p.text);
    }
  }
  return chunks.join('\n');
}

function formatUserContent(
  content: string | CompiledContentPart[],
): { content: string; images?: string[] } {
  if (typeof content === 'string') {
    return { content };
  }
  const texts: string[] = [];
  const images: string[] = [];
  for (const p of content) {
    if (p.type === 'text') {
      texts.push(p.text);
    } else if (p.type === 'image_base64') {
      images.push(p.image_base64.data);
    } else {
      texts.push(`[Image URL not sent to Ollama as base64; url=${p.image_url.url}]`);
    }
  }
  const c = texts.join('\n');
  if (images.length > 0) {
    return { content: c, images };
  }
  return { content: c };
}

function orderSystemMessagesFirst(
  messages: readonly CompiledMessage[],
): CompiledMessage[] {
  const system: CompiledMessage[] = [];
  const rest: CompiledMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      system.push(m);
    } else {
      rest.push(m);
    }
  }
  return [...system, ...rest];
}

function formatOne(message: CompiledMessage): OllamaChatMessage {
  const { role, content } = message;

  if (role === 'system') {
    return { role: 'system', content: flattenTextContent(content) };
  }

  if (role === 'user') {
    const u = formatUserContent(content);
    return u.images !== undefined
      ? { role: 'user', content: u.content, images: u.images }
      : { role: 'user', content: u.content };
  }

  if (role === 'assistant') {
    const text = flattenTextContent(content);
    if (message.toolUses !== undefined && message.toolUses.length > 0) {
      return {
        role: 'assistant',
        content: text,
        tool_calls: message.toolUses.map((tu) => ({
          function: {
            name: tu.name,
            arguments: tu.input,
          },
        })),
      };
    }
    return { role: 'assistant', content: text };
  }

  if (role === 'tool') {
    return {
      role: 'tool',
      content: flattenTextContent(content),
      tool_name: message.name ?? 'tool',
    };
  }

  if (role === 'function') {
    return {
      role: 'user',
      content: flattenTextContent(content),
    };
  }

  return { role: 'user', content: flattenTextContent(content) };
}

/**
 * Format compiled messages for Ollama `messages` (after `orderSystemMessagesFirst`).
 */
export function formatOllamaMessages(
  messages: readonly CompiledMessage[],
): OllamaChatMessage[] {
  return orderSystemMessagesFirst(messages).map(formatOne);
}

/**
 * Ollama provider adapter — use {@link registerModel} for local model names not in the built-in registry.
 */
export class OllamaAdapter extends BaseProviderAdapter {
  private tokenizer: Tokenizer | undefined;

  constructor() {
    super('ollama');
  }

  /** @inheritdoc */
  override getTokenizer(_modelId: ModelId): Tokenizer {
    if (this.tokenizer === undefined) {
      this.tokenizer = new FallbackTokenizer(() => new Cl100kTokenizer());
    }
    return this.tokenizer;
  }

  /** @inheritdoc */
  override formatMessages(
    messages: readonly CompiledMessage[],
  ): OllamaChatMessage[] {
    return formatOllamaMessages(messages);
  }
}

/** Convenience factory. */
export function createOllamaAdapter(): OllamaAdapter {
  return new OllamaAdapter();
}
