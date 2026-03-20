/**
 * Google Gemini `generateContent` payload adapter (Phase 6.5, §10).
 *
 * Shapes align with the JS client (`@google/generative-ai`): camelCase fields.
 *
 * @packageDocumentation
 */

import {
  Cl100kTokenizer,
  FallbackTokenizer,
} from '@contextcraft/tokenizers';
import {
  BaseProviderAdapter,
  type CompiledContentPart,
  type CompiledMessage,
  type ModelId,
  type Tokenizer,
} from 'contextcraft';

/** Multimodal / tool parts for `contents[].parts` and `systemInstruction.parts`. */
export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { fileUri: string; mimeType: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

/** One turn in `contents` (`model` = assistant). */
export type GeminiContent = {
  role: 'user' | 'model';
  parts: GeminiPart[];
};

/** Top-level fields commonly passed to `generateContent` / `startChat` history. */
export type GeminiGenerateContentPayload = {
  /** System / developer text (Gemini expects text-only parts here). */
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: GeminiContent[];
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

function tryParseJsonObject(text: string): Record<string, unknown> | undefined {
  const t = text.trim();
  if (t.length === 0) {
    return undefined;
  }
  try {
    const v: unknown = JSON.parse(t);
    return v !== null && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function compiledPartToGemini(part: CompiledContentPart): GeminiPart {
  if (part.type === 'text') {
    return { text: part.text };
  }
  if (part.type === 'image_url') {
    return {
      fileData: {
        fileUri: part.image_url.url,
        mimeType: mimeOrDefault(undefined),
      },
    };
  }
  const data = part.image_base64.data;
  const mimeType = mimeOrDefault(part.image_base64.mime_type);
  return { inlineData: { mimeType, data } };
}

function contentToGeminiParts(
  content: string | CompiledContentPart[],
): GeminiPart[] {
  if (typeof content === 'string') {
    return content === '' ? [] : [{ text: content }];
  }
  if (content.length === 0) {
    return [];
  }
  return content.map(compiledPartToGemini);
}

function systemPartsFromMessages(
  systemMessages: readonly CompiledMessage[],
): Array<{ text: string }> | undefined {
  const texts: string[] = [];
  for (const m of systemMessages) {
    const t = flattenTextContent(m.content);
    if (t.length > 0) {
      texts.push(t);
    }
  }
  if (texts.length === 0) {
    return undefined;
  }
  const joined = texts.join('\n\n');
  return [{ text: joined }];
}

function toolResultResponse(
  text: string,
): Record<string, unknown> {
  return tryParseJsonObject(text) ?? { output: text };
}

function compiledToGeminiContent(message: CompiledMessage): GeminiContent {
  const { role, content } = message;

  if (role === 'tool') {
    const name = message.name ?? 'tool';
    return {
      role: 'user',
      parts: [
        {
          functionResponse: {
            name,
            response: toolResultResponse(flattenTextContent(content)),
          },
        },
      ],
    };
  }

  if (role === 'function') {
    return {
      role: 'user',
      parts: contentToGeminiParts(content),
    };
  }

  if (role === 'assistant') {
    const parts: GeminiPart[] = contentToGeminiParts(content);
    if (message.toolUses !== undefined) {
      for (const tu of message.toolUses) {
        parts.push({
          functionCall: { name: tu.name, args: tu.input },
        });
      }
    }
    return { role: 'model', parts };
  }

  if (role === 'user') {
    return { role: 'user', parts: contentToGeminiParts(content) };
  }

  // `system` stripped earlier; treat anything else as user.
  return {
    role: 'user',
    parts: contentToGeminiParts(content),
  };
}

function mergeGeminiContent(a: GeminiContent, b: GeminiContent): GeminiContent {
  return { role: a.role, parts: [...a.parts, ...b.parts] };
}

/** Merge consecutive entries with the same `role` (recommended for Gemini turns). */
export function collapseConsecutiveGeminiRoles(
  contents: readonly GeminiContent[],
): GeminiContent[] {
  const out: GeminiContent[] = [];
  for (const c of contents) {
    const last = out[out.length - 1];
    if (last !== undefined && last.role === c.role) {
      out[out.length - 1] = mergeGeminiContent(last, c);
    } else {
      out.push({ role: c.role, parts: [...c.parts] });
    }
  }
  return out;
}

/**
 * Build `systemInstruction` + `contents` for Gemini from compiled messages.
 */
export function formatGeminiMessages(
  messages: readonly CompiledMessage[],
): GeminiGenerateContentPayload {
  const systemMsgs: CompiledMessage[] = [];
  const rest: CompiledMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemMsgs.push(m);
    } else {
      rest.push(m);
    }
  }

  const sysParts = systemPartsFromMessages(systemMsgs);
  const raw = rest.map(compiledToGeminiContent);
  const contents = collapseConsecutiveGeminiRoles(raw);

  const payload: GeminiGenerateContentPayload = { contents };
  if (sysParts !== undefined) {
    payload.systemInstruction = { parts: sysParts };
  }
  return payload;
}

/**
 * Google Gemini provider adapter — `cl100k`-based counting (approximation) + formatting.
 */
export class GoogleAdapter extends BaseProviderAdapter {
  private tokenizer: Tokenizer | undefined;

  constructor() {
    super('google');
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
  ): GeminiGenerateContentPayload {
    return formatGeminiMessages(messages);
  }
}

/** Convenience factory. */
export function createGoogleAdapter(): GoogleAdapter {
  return new GoogleAdapter();
}
