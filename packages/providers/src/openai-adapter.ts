/**
 * OpenAI Chat Completions adapter (§10).
 *
 * @packageDocumentation
 */

import {
  Cl100kTokenizer,
  FallbackTokenizer,
  O200kTokenizer,
} from '@slotmux/tokenizers';
import {
  BaseProviderAdapter,
  type CompiledContentPart,
  type CompiledMessage,
  type ModelId,
  type Tokenizer,
} from 'slotmux';

/** OpenAI `content` part — text or image URL (incl. data URLs for vision). */
export type OpenAIChatContentPart =
  | { type: 'text'; text: string }
  | {
      type: 'image_url';
      image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
    };

/**
 * Messages shaped for `chat.completions.create({ messages })` (and compatible APIs).
 */
export type OpenAIChatCompletionMessage =
  | {
      role: 'system';
      content: string | OpenAIChatContentPart[];
      name?: string;
    }
  | {
      role: 'user';
      content: string | OpenAIChatContentPart[];
      name?: string;
    }
  | {
      role: 'assistant';
      content: string | OpenAIChatContentPart[] | null;
      name?: string;
    }
  | {
      role: 'tool';
      tool_call_id: string;
      content: string;
      name?: string;
    }
  | {
      role: 'function';
      name: string;
      content: string;
    };

function mimeOrDefault(mime?: string): string {
  return mime !== undefined && mime !== '' ? mime : 'image/png';
}

function compiledPartToOpenAI(part: CompiledContentPart): OpenAIChatContentPart {
  if (part.type === 'text') {
    return { type: 'text', text: part.text };
  }
  if (part.type === 'image_url') {
    const url = part.image_url.url;
    const detail = part.image_url.detail;
    return {
      type: 'image_url',
      image_url:
        detail !== undefined ? { url, detail } : { url },
    };
  }
  const data = part.image_base64.data;
  const mime = mimeOrDefault(part.image_base64.mime_type);
  const url = `data:${mime};base64,${data}`;
  return { type: 'image_url', image_url: { url } };
}

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

function formatContentForRolesAllowingMultimodal(
  role: 'system' | 'user' | 'assistant',
  content: string | CompiledContentPart[],
): string | OpenAIChatContentPart[] | null {
  if (typeof content === 'string') {
    return content;
  }
  if (content.length === 0) {
    return role === 'assistant' ? null : '';
  }
  const allText = content.every((p) => p.type === 'text');
  if (allText) {
    const text = (content as { type: 'text'; text: string }[])
      .map((p) => p.text)
      .join('');
    return text;
  }
  return content.map(compiledPartToOpenAI);
}

function formatOne(message: CompiledMessage): OpenAIChatCompletionMessage {
  const { role, name } = message;
  const content = message.content;

  if (role === 'tool') {
    const toolCallId = message.tool_call_id ?? '';
    return {
      role: 'tool',
      tool_call_id: toolCallId,
      content: flattenTextContent(content),
      ...(name !== undefined ? { name } : {}),
    };
  }

  if (role === 'function') {
    return {
      role: 'function',
      name: name ?? 'function',
      content: flattenTextContent(content),
    };
  }

  const formatted = formatContentForRolesAllowingMultimodal(role, content);
  const base = {
    role,
    content: formatted,
    ...(name !== undefined ? { name } : {}),
  } as OpenAIChatCompletionMessage;
  return base;
}

/**
 * Order messages so all `system` roles come first (OpenAI convention / §6.3).
 */
export function orderSystemMessagesFirst(
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

/**
 * Format compiled messages for the OpenAI Chat Completions `messages` parameter.
 */
export function formatOpenAIMessages(
  messages: readonly CompiledMessage[],
): OpenAIChatCompletionMessage[] {
  return orderSystemMessagesFirst(messages).map(formatOne);
}

const tokenizerKey = (name: string): 'cl100k_base' | 'o200k_base' =>
  name === 'cl100k_base' ? 'cl100k_base' : 'o200k_base';

/**
 * OpenAI provider adapter — registry-backed caps, tiktoken-backed counting (with char fallback).
 */
export class OpenAIAdapter extends BaseProviderAdapter {
  private readonly tokenizerByEncoding = new Map<
    'cl100k_base' | 'o200k_base',
    Tokenizer
  >();

  constructor() {
    super('openai');
  }

  /** @inheritdoc */
  override getTokenizer(modelId: ModelId): Tokenizer {
    const enc = tokenizerKey(this.resolveModel(modelId).tokenizerName);
    let tok = this.tokenizerByEncoding.get(enc);
    if (tok === undefined) {
      tok =
        enc === 'cl100k_base'
          ? new FallbackTokenizer(() => new Cl100kTokenizer())
          : new FallbackTokenizer(() => new O200kTokenizer());
      this.tokenizerByEncoding.set(enc, tok);
    }
    return tok;
  }

  /** @inheritdoc */
  override formatMessages(
    messages: readonly CompiledMessage[],
  ): OpenAIChatCompletionMessage[] {
    return formatOpenAIMessages(messages);
  }
}

/** Convenience factory. */
export function createOpenAIAdapter(): OpenAIAdapter {
  return new OpenAIAdapter();
}
