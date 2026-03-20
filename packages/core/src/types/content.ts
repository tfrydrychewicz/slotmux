/**
 * Content types for messages and compiled output.
 *
 * @packageDocumentation
 */

import type { ContentId, TokenCount } from './branded.js';

// ==========================================
// Message Role
// ==========================================

/** Message role for provider formatting */
export type MessageRole =
  | 'system'
  | 'user'
  | 'assistant'
  | 'tool'
  | 'function';

// ==========================================
// Multimodal Content
// ==========================================

/** Text content block */
export interface MultimodalContentText {
  type: 'text';
  text: string;
}

/** Image URL content block */
export interface MultimodalContentImageUrl {
  type: 'image_url';
  imageUrl?: string;
  image_url?: string;
  mimeType?: string;
  tokenEstimate?: number;
}

/** Base64 image content block */
export interface MultimodalContentImageBase64 {
  type: 'image_base64';
  imageBase64?: string;
  image_base64?: string;
  mimeType?: string;
  tokenEstimate?: number;
}

/** Multimodal content block — text or image */
export type MultimodalContent =
  | MultimodalContentText
  | MultimodalContentImageUrl
  | MultimodalContentImageBase64;

/**
 * Assistant-issued tool call (Anthropic `tool_use` / cross-provider tool rounds).
 */
export interface CompiledToolUse {
  id: string;
  name: string;
  /** JSON-serializable arguments for the tool invocation */
  input: Record<string, unknown>;
}

// ==========================================
// Content Item
// ==========================================

/** Content item within a slot */
export interface ContentItem {
  /** Unique identifier (auto-generated if not provided) */
  id: ContentId;

  /** The role of this content in the conversation */
  role: MessageRole;

  /** Text content. Can also be multimodal (see MultimodalContent). */
  content: string | MultimodalContent[];

  /** Which slot this content belongs to */
  slot: string;

  /** Token count (lazily computed and cached) */
  tokens?: TokenCount;

  /** Arbitrary metadata attached by the developer */
  metadata?: Record<string, unknown>;

  /** If true, this item is exempt from overflow */
  pinned?: boolean;

  /** If true, this item is removed after the next build() */
  ephemeral?: boolean;

  /** Timestamp of insertion (for ordering and summarization boundaries) */
  createdAt: number;

  /** If this item is a summary of other items, track the originals */
  summarizes?: ContentId[];

  /** OpenAI-style participant name (multi-user / named assistants). */
  name?: string;

  /** OpenAI `tool` role: id of the tool call this message responds to. */
  toolCallId?: string;

  /** Assistant `tool_use` blocks (paired with user `tool_result` / OpenAI `tool`). */
  toolUses?: readonly CompiledToolUse[];
}

// ==========================================
// Compiled Message (Provider-Agnostic)
// ==========================================

/** Text content part for compiled messages */
export interface CompiledContentText {
  type: 'text';
  text: string;
}

/** Image URL content part */
export interface CompiledContentImageUrl {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
}

/** Base64 image content part */
export interface CompiledContentImageBase64 {
  type: 'image_base64';
  image_base64: { data: string; mime_type?: string };
}

/** Content part in a compiled message */
export type CompiledContentPart =
  | CompiledContentText
  | CompiledContentImageUrl
  | CompiledContentImageBase64;

/**
 * Provider-agnostic compiled message format.
 * Adapters convert this to provider-specific formats (OpenAI, Anthropic, etc.).
 */
export interface CompiledMessage {
  /** Message role */
  role: MessageRole;

  /** Content — string for simple text, array for multimodal */
  content: string | CompiledContentPart[];

  /** Optional name (e.g. for multi-user conversations) */
  name?: string;

  /**
   * OpenAI Chat Completions: required for `tool` role (paired with assistant `tool_calls`).
   * Prefer setting {@link ContentItem.toolCallId} at compile time.
   */
  tool_call_id?: string;

  /** Assistant `tool_use` blocks (Anthropic Messages API). */
  toolUses?: readonly CompiledToolUse[];
}
