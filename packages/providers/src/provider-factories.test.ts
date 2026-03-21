import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { anthropic } from './anthropic-provider.js';
import { google } from './google-provider.js';
import { mistral } from './mistral-provider.js';
import { ollama } from './ollama-provider.js';
import { openai } from './openai-provider.js';
import { wrapCustomSummarize } from './provider-factory.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openai()', () => {
  it('returns a SlotmuxProvider with adapter and summarizeText', () => {
    const provider = openai({ apiKey: 'test-key' });
    expect(provider.adapter.id).toBe('openai');
    expect(provider.summarizeText).toBeTypeOf('function');
  });

  it('calls OpenAI chat completions for summarization', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'Summary text' } }] }),
        { status: 200 },
      ),
    );

    const provider = openai({ apiKey: 'test-key' });
    const result = await provider.summarizeText!({
      layer: 1,
      systemPrompt: 'Summarize this',
      userPayload: 'Long text here',
    });

    expect(result).toEqual({ text: 'Summary text', finishReason: null, httpStatus: 200 });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      }),
    );

    const body = JSON.parse(
      (mockFetch.mock.calls[0]![1] as { body: string }).body,
    ) as Record<string, unknown>;
    expect(body['model']).toBe('gpt-5.4-mini');
  });

  it('uses custom compressionModel', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
        { status: 200 },
      ),
    );

    const provider = openai({
      apiKey: 'test-key',
      compressionModel: 'gpt-5.4-nano',
    });
    await provider.summarizeText!({
      layer: 1,
      systemPrompt: 'S',
      userPayload: 'U',
    });

    const body = JSON.parse(
      (mockFetch.mock.calls[0]![1] as { body: string }).body,
    ) as Record<string, unknown>;
    expect(body['model']).toBe('gpt-5.4-nano');
  });

  it('uses custom baseUrl', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
        { status: 200 },
      ),
    );

    const provider = openai({
      apiKey: 'key',
      baseUrl: 'https://my-proxy.example.com',
    });
    await provider.summarizeText!({
      layer: 1,
      systemPrompt: 'S',
      userPayload: 'U',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://my-proxy.example.com/chat/completions',
      expect.anything(),
    );
  });

  it('uses custom summarize function', async () => {
    const customFn = vi
      .fn()
      .mockResolvedValue('custom summary');

    const provider = openai({
      apiKey: 'key',
      summarize: customFn,
    });

    const result = await provider.summarizeText!({
      layer: 2,
      systemPrompt: 'sys',
      userPayload: 'usr',
    });

    expect(result).toBe('custom summary');
    expect(customFn).toHaveBeenCalledWith('sys', 'usr');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('includes embed when provided', () => {
    const embedFn = vi.fn();
    const provider = openai({ apiKey: 'key', embed: embedFn });
    expect(provider.embed).toBe(embedFn);
  });

  it('omits embed when not provided', () => {
    const provider = openai({ apiKey: 'key' });
    expect(provider.embed).toBeUndefined();
  });
});

describe('anthropic()', () => {
  it('returns a SlotmuxProvider with adapter and summarizeText', () => {
    const provider = anthropic({ apiKey: 'test-key' });
    expect(provider.adapter.id).toBe('anthropic');
    expect(provider.summarizeText).toBeTypeOf('function');
  });

  it('calls Anthropic messages API for summarization', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ content: [{ type: 'text', text: 'Anthropic summary' }] }),
        { status: 200 },
      ),
    );

    const provider = anthropic({ apiKey: 'test-key' });
    const result = await provider.summarizeText!({
      layer: 1,
      systemPrompt: 'Summarize',
      userPayload: 'Content',
    });

    expect(result).toBe('Anthropic summary');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'test-key',
          'anthropic-version': '2023-06-01',
        }),
      }),
    );

    const body = JSON.parse(
      (mockFetch.mock.calls[0]![1] as { body: string }).body,
    ) as Record<string, unknown>;
    expect(body['model']).toBe('claude-3-5-haiku-20241022');
  });
});

describe('google()', () => {
  it('returns a SlotmuxProvider with adapter and summarizeText', () => {
    const provider = google({ apiKey: 'test-key' });
    expect(provider.adapter.id).toBe('google');
    expect(provider.summarizeText).toBeTypeOf('function');
  });

  it('calls Gemini generateContent for summarization', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Gemini summary' }] } }],
        }),
        { status: 200 },
      ),
    );

    const provider = google({ apiKey: 'test-key' });
    const result = await provider.summarizeText!({
      layer: 1,
      systemPrompt: 'Summarize',
      userPayload: 'Content',
    });

    expect(result).toBe('Gemini summary');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(
        'generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      ),
      expect.anything(),
    );
  });
});

describe('mistral()', () => {
  it('returns a SlotmuxProvider with adapter and summarizeText', () => {
    const provider = mistral({ apiKey: 'test-key' });
    expect(provider.adapter.id).toBe('mistral');
    expect(provider.summarizeText).toBeTypeOf('function');
  });

  it('calls Mistral chat completions for summarization', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'Mistral summary' } }] }),
        { status: 200 },
      ),
    );

    const provider = mistral({ apiKey: 'test-key' });
    const result = await provider.summarizeText!({
      layer: 1,
      systemPrompt: 'Summarize',
      userPayload: 'Content',
    });

    expect(result).toBe('Mistral summary');
    const body = JSON.parse(
      (mockFetch.mock.calls[0]![1] as { body: string }).body,
    ) as Record<string, unknown>;
    expect(body['model']).toBe('mistral-small-latest');
  });
});

describe('ollama()', () => {
  it('returns a SlotmuxProvider with adapter and summarizeText', () => {
    const provider = ollama();
    expect(provider.adapter.id).toBe('ollama');
    expect(provider.summarizeText).toBeTypeOf('function');
  });

  it('calls local Ollama API for summarization', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ message: { content: 'Ollama summary' } }),
        { status: 200 },
      ),
    );

    const provider = ollama({ compressionModel: 'llama3.2' });
    const result = await provider.summarizeText!({
      layer: 1,
      systemPrompt: 'Summarize',
      userPayload: 'Content',
    });

    expect(result).toBe('Ollama summary');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.anything(),
    );
    const body = JSON.parse(
      (mockFetch.mock.calls[0]![1] as { body: string }).body,
    ) as Record<string, unknown>;
    expect(body['model']).toBe('llama3.2');
    expect(body['stream']).toBe(false);
  });

  it('does not require apiKey', () => {
    const provider = ollama();
    expect(provider.adapter.id).toBe('ollama');
  });
});

describe('wrapCustomSummarize', () => {
  it('wraps (system, user) fn into SummarizeTextFn shape', async () => {
    const fn = vi.fn().mockResolvedValue('wrapped result');
    const wrapped = wrapCustomSummarize(fn);

    const result = await wrapped({
      layer: 1,
      systemPrompt: 'sys',
      userPayload: 'usr',
    });

    expect(result).toBe('wrapped result');
    expect(fn).toHaveBeenCalledWith('sys', 'usr');
  });
});
