import { describe, expect, it } from 'vitest';

import { toTokenCount } from '../../src/types/branded.js';
import type { ProviderId, ModelId } from '../../src/types/config.js';
import type {
  Tokenizer,
  ModelCapabilities,
  ProviderAdapter,
} from '../../src/types/provider.js';

describe('Tokenizer', () => {
  it('accepts tokenizer with required methods', () => {
    const tokenizer: Tokenizer = {
      id: 'cl100k_base',
      count: (text) => toTokenCount(Math.ceil(text.length / 4)),
      countMessage: (msg) =>
        toTokenCount(
          typeof msg.content === 'string'
            ? Math.ceil(msg.content.length / 4)
            : 0,
        ),
      countMessages: (msgs) =>
        toTokenCount(
          msgs.reduce(
            (sum, m) =>
              sum +
              (typeof m.content === 'string'
                ? Math.ceil(m.content.length / 4)
                : 0),
            0,
          ),
        ),
      encode: (text) => text.split('').map((c) => c.charCodeAt(0)),
      decode: (tokens) =>
        String.fromCharCode(...tokens.map((t) => Math.min(t, 65535))),
      truncateToFit: (text, maxTokens) =>
        text.slice(0, Math.min(text.length, maxTokens * 4)),
    };
    expect(tokenizer.id).toBe('cl100k_base');
    expect(tokenizer.count('hello')).toBe(2);
  });
});

describe('ModelCapabilities', () => {
  it('accepts full model capabilities', () => {
    const caps: ModelCapabilities = {
      maxContextTokens: 128_000,
      maxOutputTokens: 16_384,
      supportsFunctions: true,
      supportsVision: true,
      supportsStreaming: true,
      tokenizerName: 'cl100k_base',
      costPer1kInputTokens: 0.01,
      costPer1kOutputTokens: 0.03,
    };
    expect(caps.maxContextTokens).toBe(128_000);
    expect(caps.tokenizerName).toBe('cl100k_base');
  });

  it('accepts minimal model capabilities', () => {
    const caps: ModelCapabilities = {
      maxContextTokens: 8000,
      maxOutputTokens: 2048,
      supportsFunctions: false,
      supportsVision: false,
      supportsStreaming: true,
      tokenizerName: 'gpt2',
    };
    expect(caps.supportsVision).toBe(false);
  });
});

describe('ProviderAdapter', () => {
  it('accepts adapter-shaped object', () => {
    const tokenizer: Tokenizer = {
      id: 'test',
      count: () => toTokenCount(0),
      countMessage: () => toTokenCount(0),
      countMessages: () => toTokenCount(0),
      encode: () => [],
      decode: () => '',
      truncateToFit: (t) => t,
    };

    const adapter: ProviderAdapter = {
      id: 'openai' as ProviderId,
      resolveModel: (modelId: ModelId) => ({
        maxContextTokens: modelId.includes('gpt') ? 128_000 : 64_000,
        maxOutputTokens: 16_384,
        supportsFunctions: true,
        supportsVision: true,
        supportsStreaming: true,
        tokenizerName: 'cl100k_base',
      }),
      formatMessages: (messages) => messages,
      getTokenizer: () => tokenizer,
      calculateOverhead: () => toTokenCount(4),
    };

    expect(adapter.id).toBe('openai');
    const caps = adapter.resolveModel('gpt-4-turbo');
    expect(caps.maxContextTokens).toBe(128_000);
    expect(adapter.getTokenizer('gpt-4').id).toBe('test');
  });
});
