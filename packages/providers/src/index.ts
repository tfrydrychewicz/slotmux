/**
 * @slotmux/providers — LLM provider adapters and factories
 *
 * @packageDocumentation
 */

export const VERSION = '1.0.0-rc.1';

export type {
  MapReduceDeps,
  SlotmuxProvider,
  SlotmuxProviderOptions,
  SummarizeTextFn,
  SummarizeTextResult,
} from './provider-factory.js';
export { wrapCustomSummarize } from './provider-factory.js';

export { createAdaptiveRateLimiter } from './adaptive-rate-limiter.js';
export type { AdaptiveRateLimiter, AdaptiveRateLimiterOptions } from './adaptive-rate-limiter.js';

export { fetchWithRetry, ProviderRateLimitError, parseRetryAfterBody } from './fetch-with-retry.js';
export { sanitizeLLMInput, withSanitizedInputs } from './sanitize-llm-input.js';
export type { FetchWithRetryOptions } from './fetch-with-retry.js';

export { openai } from './openai-provider.js';
export { createOpenAIChatFetcher, OpenAIApiError } from './openai-fetch.js';
export type { OpenAIChatResult, OpenAIChatFetcherOptions } from './openai-fetch.js';
export { anthropic } from './anthropic-provider.js';
export { google } from './google-provider.js';
export { mistral } from './mistral-provider.js';
export { ollama } from './ollama-provider.js';
export type { OllamaProviderOptions } from './ollama-provider.js';

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
