/**
 * Anthropic Messages API adapter (Phase 6.4, §10).
 *
 * @packageDocumentation
 */

import {
  ClaudeTokenizer,
  FallbackTokenizer,
} from '@contextcraft/tokenizers';
import {
  BaseProviderAdapter,
  type CompiledContentPart,
  type CompiledMessage,
  type ModelId,
  type Tokenizer,
} from 'contextcraft';

/** Anthropic text block. */
export type AnthropicTextBlock = { type: 'text'; text: string };

/** Anthropic image block (base64 or URL source). */
export type AnthropicImageBlock = {
  type: 'image';
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string };
};

/** Assistant tool invocation. */
export type AnthropicToolUseBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};

/** User tool result (paired with assistant `tool_use`). */
export type AnthropicToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
};

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

/**
 * Single turn in `messages` (user ↔ assistant only on the wire).
 */
export type AnthropicMessageParam = {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
};

/**
 * Payload aligned with `POST /v1/messages` body (`system` + `messages`).
 */
export type AnthropicMessagesPayload = {
  system?: string;
  messages: AnthropicMessageParam[];
};

function mimeOrDefault(mime?: string): string {
  return mime !== undefined && mime !== '' ? mime : 'image/png';
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

function compiledPartToAnthropic(
  part: CompiledContentPart,
): AnthropicContentBlock {
  if (part.type === 'text') {
    return { type: 'text', text: part.text };
  }
  if (part.type === 'image_url') {
    return {
      type: 'image',
      source: { type: 'url', url: part.image_url.url },
    };
  }
  const data = part.image_base64.data;
  const media_type = mimeOrDefault(part.image_base64.mime_type);
  return {
    type: 'image',
    source: { type: 'base64', media_type, data },
  };
}

function contentToAnthropicBlocks(
  content: string | CompiledContentPart[],
): AnthropicContentBlock[] {
  if (typeof content === 'string') {
    return content === '' ? [] : [{ type: 'text', text: content }];
  }
  if (content.length === 0) {
    return [];
  }
  return content.map(compiledPartToAnthropic);
}

function systemTextFromMessages(
  systemMessages: readonly CompiledMessage[],
): string | undefined {
  const chunks: string[] = [];
  for (const m of systemMessages) {
    chunks.push(flattenTextContent(m.content));
  }
  const joined = chunks.filter((s) => s.length > 0).join('\n\n');
  return joined.length > 0 ? joined : undefined;
}

function toBlocks(content: string | AnthropicContentBlock[]): AnthropicContentBlock[] {
  if (typeof content === 'string') {
    return content === '' ? [] : [{ type: 'text', text: content }];
  }
  return content;
}

function coalesceAdjacentTextBlocks(
  blocks: AnthropicContentBlock[],
): AnthropicContentBlock[] {
  const out: AnthropicContentBlock[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (b.type === 'text' && last !== undefined && last.type === 'text') {
      out[out.length - 1] = {
        type: 'text',
        text: last.text + b.text,
      };
    } else {
      out.push(b);
    }
  }
  return out;
}

function simplifyContent(
  blocks: AnthropicContentBlock[],
): string | AnthropicContentBlock[] {
  if (blocks.length === 0) {
    return '';
  }
  const only = blocks[0];
  if (blocks.length === 1 && only !== undefined && only.type === 'text') {
    return only.text;
  }
  return blocks;
}

function mergeParams(
  a: AnthropicMessageParam,
  b: AnthropicMessageParam,
): AnthropicMessageParam {
  const merged = coalesceAdjacentTextBlocks([
    ...toBlocks(a.content),
    ...toBlocks(b.content),
  ]);
  return { role: a.role, content: simplifyContent(merged) };
}

/** Merge consecutive messages with the same role (Messages API convention). */
export function collapseConsecutiveRoles(
  messages: readonly AnthropicMessageParam[],
): AnthropicMessageParam[] {
  const out: AnthropicMessageParam[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last !== undefined && last.role === m.role) {
      out[out.length - 1] = mergeParams(last, m);
    } else {
      out.push(m);
    }
  }
  return out;
}

function compiledToAnthropicParam(
  message: CompiledMessage,
): AnthropicMessageParam {
  const { role, content } = message;

  if (role === 'tool') {
    const toolUseId = message.tool_call_id ?? '';
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: flattenTextContent(content),
        },
      ],
    };
  }

  if (role === 'function') {
    return {
      role: 'user',
      content: flattenTextContent(content),
    };
  }

  if (role === 'user') {
    return {
      role: 'user',
      content: simplifyContent(contentToAnthropicBlocks(content)),
    };
  }

  if (role === 'assistant') {
    const blocks: AnthropicContentBlock[] = contentToAnthropicBlocks(content);
    if (message.toolUses !== undefined) {
      for (const tu of message.toolUses) {
        blocks.push({
          type: 'tool_use',
          id: tu.id,
          name: tu.name,
          input: tu.input,
        });
      }
    }
    return {
      role: 'assistant',
      content: simplifyContent(blocks),
    };
  }

  // `system` is stripped before this runs; treat unknown as user text.
  return {
    role: 'user',
    content: flattenTextContent(content),
  };
}

/**
 * Split system prompts out and build Anthropic `system` + `messages`.
 */
export function formatAnthropicMessages(
  messages: readonly CompiledMessage[],
): AnthropicMessagesPayload {
  const systemMsgs: CompiledMessage[] = [];
  const rest: CompiledMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemMsgs.push(m);
    } else {
      rest.push(m);
    }
  }

  const system = systemTextFromMessages(systemMsgs);
  const params = rest.map(compiledToAnthropicParam);
  const collapsed = collapseConsecutiveRoles(params);

  return {
    ...(system !== undefined ? { system } : {}),
    messages: collapsed,
  };
}

/**
 * Anthropic provider adapter — Claude tokenizer + Messages API formatting.
 */
export class AnthropicAdapter extends BaseProviderAdapter {
  private tokenizer: Tokenizer | undefined;

  constructor() {
    super('anthropic');
  }

  /** @inheritdoc */
  override getTokenizer(_modelId: ModelId): Tokenizer {
    if (this.tokenizer === undefined) {
      this.tokenizer = new FallbackTokenizer(() => new ClaudeTokenizer());
    }
    return this.tokenizer;
  }

  /** @inheritdoc */
  override formatMessages(
    messages: readonly CompiledMessage[],
  ): AnthropicMessagesPayload {
    return formatAnthropicMessages(messages);
  }
}

/** Convenience factory. */
export function createAnthropicAdapter(): AnthropicAdapter {
  return new AnthropicAdapter();
}
