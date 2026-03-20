/**
 * @slotmux/providers — LLM provider adapters
 *
 * @packageDocumentation
 */

export const VERSION = '0.0.1';

export {
  createAnthropicAdapter,
  AnthropicAdapter,
  collapseConsecutiveRoles,
  formatAnthropicMessages,
} from './anthropic-adapter.js';
export type {
  AnthropicContentBlock,
  AnthropicImageBlock,
  AnthropicMessageParam,
  AnthropicMessagesPayload,
  AnthropicTextBlock,
  AnthropicToolResultBlock,
  AnthropicToolUseBlock,
} from './anthropic-adapter.js';
export {
  collapseConsecutiveGeminiRoles,
  createGoogleAdapter,
  formatGeminiMessages,
  GoogleAdapter,
} from './google-adapter.js';
export type {
  GeminiContent,
  GeminiGenerateContentPayload,
  GeminiPart,
} from './google-adapter.js';
export {
  createMistralAdapter,
  formatMistralMessages,
  MistralAdapter,
} from './mistral-adapter.js';
export type { MistralChatMessage } from './mistral-adapter.js';
export {
  createOllamaAdapter,
  formatOllamaMessages,
  OllamaAdapter,
} from './ollama-adapter.js';
export type { OllamaChatMessage, OllamaToolCall } from './ollama-adapter.js';
export {
  createOpenAIAdapter,
  formatOpenAIMessages,
  OpenAIAdapter,
  orderSystemMessagesFirst,
} from './openai-adapter.js';
export type {
  OpenAIChatCompletionMessage,
  OpenAIChatContentPart,
} from './openai-adapter.js';
