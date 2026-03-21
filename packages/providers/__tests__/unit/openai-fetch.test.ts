import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  createOpenAIChatFetcher,
  OpenAIApiError,
} from '../../src/openai-fetch.js';
import { ProviderRateLimitError } from '../../src/fetch-with-retry.js';

// ── Helpers ──────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function okCompletion(content: string, finishReason = 'stop'): Response {
  return jsonResponse({
    choices: [{ message: { content }, finish_reason: finishReason }],
  });
}

function unsupportedParamError(param: string): Response {
  return jsonResponse(
    {
      error: {
        message: `Unsupported parameter: '${param}' is not supported with this model.`,
        type: 'invalid_request_error',
        param,
        code: 'unsupported_parameter',
      },
    },
    400,
  );
}

function rateLimitError(retryHint: string): Response {
  return jsonResponse(
    {
      error: {
        message: `Rate limit reached. Please try again in ${retryHint}.`,
        type: 'tokens',
        param: null,
        code: 'rate_limit_exceeded',
      },
    },
    429,
  );
}

const BASE_OPTS = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test-key',
  model: 'gpt-5.4-mini',
} as const;

const MESSAGES = [
  { role: 'system', content: 'Summarize.' },
  { role: 'user', content: 'Hello world.' },
] as const;

// ── Tests ────────────────────────────────────────────────────────────

describe('createOpenAIChatFetcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mockFetch(): ReturnType<typeof vi.fn> {
    return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  }

  describe('auto-detect max_tokens param', () => {
    it('sends max_completion_tokens by default (newer models)', async () => {
      mockFetch().mockResolvedValueOnce(okCompletion('summary'));

      const chat = createOpenAIChatFetcher(BASE_OPTS);
      const result = await chat({ messages: MESSAGES, maxOutputTokens: 500 });

      expect(result.content).toBe('summary');
      expect(result.httpStatus).toBe(200);

      const body = JSON.parse(mockFetch().mock.calls[0]![1].body as string);
      expect(body).toHaveProperty('max_completion_tokens', 500);
      expect(body).not.toHaveProperty('max_tokens');
    });

    it('falls back to max_tokens when max_completion_tokens is rejected', async () => {
      mockFetch()
        .mockResolvedValueOnce(unsupportedParamError('max_completion_tokens'))
        .mockResolvedValueOnce(okCompletion('fallback summary'));

      const chat = createOpenAIChatFetcher(BASE_OPTS);
      const result = await chat({ messages: MESSAGES, maxOutputTokens: 500 });

      expect(result.content).toBe('fallback summary');
      expect(mockFetch()).toHaveBeenCalledTimes(2);

      const retryBody = JSON.parse(mockFetch().mock.calls[1]![1].body as string);
      expect(retryBody).toHaveProperty('max_tokens', 500);
      expect(retryBody).not.toHaveProperty('max_completion_tokens');
    });

    it('caches detected param for subsequent calls', async () => {
      mockFetch()
        .mockResolvedValueOnce(unsupportedParamError('max_completion_tokens'))
        .mockResolvedValueOnce(okCompletion('first'))
        .mockResolvedValueOnce(okCompletion('second'));

      const chat = createOpenAIChatFetcher(BASE_OPTS);
      await chat({ messages: MESSAGES, maxOutputTokens: 100 });
      await chat({ messages: MESSAGES, maxOutputTokens: 200 });

      expect(mockFetch()).toHaveBeenCalledTimes(3);
      const thirdBody = JSON.parse(mockFetch().mock.calls[2]![1].body as string);
      expect(thirdBody).toHaveProperty('max_tokens', 200);
      expect(thirdBody).not.toHaveProperty('max_completion_tokens');
    });

    it('skips param detection when maxOutputTokens is undefined', async () => {
      mockFetch().mockResolvedValueOnce(okCompletion('no limit'));

      const chat = createOpenAIChatFetcher(BASE_OPTS);
      const result = await chat({ messages: MESSAGES });

      expect(result.content).toBe('no limit');
      const body = JSON.parse(mockFetch().mock.calls[0]![1].body as string);
      expect(body).not.toHaveProperty('max_tokens');
      expect(body).not.toHaveProperty('max_completion_tokens');
    });
  });

  describe('rate limit retry (delegated to fetchWithRetry)', () => {
    it('retries on 429 and succeeds', async () => {
      mockFetch()
        .mockResolvedValueOnce(rateLimitError('500ms'))
        .mockResolvedValueOnce(okCompletion('after retry'));

      const chat = createOpenAIChatFetcher({ ...BASE_OPTS, maxRetries: 3 });
      const promise = chat({ messages: MESSAGES, maxOutputTokens: 100 });

      await vi.advanceTimersByTimeAsync(600);

      const result = await promise;
      expect(result.content).toBe('after retry');
      expect(mockFetch()).toHaveBeenCalledTimes(2);
    });

    it('throws ProviderRateLimitError when maxRetries is 0', async () => {
      vi.useRealTimers();
      mockFetch().mockResolvedValueOnce(rateLimitError('1s'));

      const chat = createOpenAIChatFetcher({ ...BASE_OPTS, maxRetries: 0 });

      await expect(
        chat({ messages: MESSAGES, maxOutputTokens: 100 }),
      ).rejects.toThrow(ProviderRateLimitError);
      expect(mockFetch()).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('throws OpenAIApiError on 401', async () => {
      mockFetch().mockResolvedValueOnce(
        jsonResponse({ error: { message: 'Invalid API key' } }, 401),
      );

      const chat = createOpenAIChatFetcher(BASE_OPTS);
      await expect(chat({ messages: MESSAGES })).rejects.toThrow(OpenAIApiError);
    });

    it('throws OpenAIApiError on 500', async () => {
      mockFetch().mockResolvedValueOnce(
        jsonResponse({ error: { message: 'Internal server error' } }, 500),
      );

      const chat = createOpenAIChatFetcher(BASE_OPTS);
      await expect(chat({ messages: MESSAGES })).rejects.toThrow(OpenAIApiError);
    });

    it('throws OpenAIApiError when response body contains error on 200', async () => {
      mockFetch().mockResolvedValueOnce(
        jsonResponse({
          error: { message: 'Model overloaded', type: 'server_error' },
        }),
      );

      const chat = createOpenAIChatFetcher(BASE_OPTS);
      await expect(chat({ messages: MESSAGES })).rejects.toThrow(OpenAIApiError);
    });

    it('throws on non-JSON 400 (not unsupported_parameter)', async () => {
      mockFetch().mockResolvedValueOnce(
        new Response('Bad Request', { status: 400 }),
      );

      const chat = createOpenAIChatFetcher(BASE_OPTS);
      await expect(
        chat({ messages: MESSAGES, maxOutputTokens: 100 }),
      ).rejects.toThrow(OpenAIApiError);
    });

    it('does not retry non-429 errors', async () => {
      mockFetch().mockResolvedValueOnce(
        jsonResponse({ error: { message: 'Bad request' } }, 400),
      );

      const chat = createOpenAIChatFetcher({ ...BASE_OPTS, maxRetries: 3 });
      await expect(
        chat({ messages: MESSAGES }),
      ).rejects.toThrow(OpenAIApiError);
      expect(mockFetch()).toHaveBeenCalledTimes(1);
    });

    it('includes httpStatus on thrown errors', async () => {
      mockFetch().mockResolvedValueOnce(
        jsonResponse({ error: { message: 'Forbidden' } }, 403),
      );

      const chat = createOpenAIChatFetcher(BASE_OPTS);
      try {
        await chat({ messages: MESSAGES });
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(OpenAIApiError);
        expect((e as OpenAIApiError).httpStatus).toBe(403);
      }
    });
  });

  describe('successful responses', () => {
    it('returns content and finishReason', async () => {
      mockFetch().mockResolvedValueOnce(okCompletion('hello', 'length'));

      const chat = createOpenAIChatFetcher(BASE_OPTS);
      const result = await chat({ messages: MESSAGES });

      expect(result.content).toBe('hello');
      expect(result.finishReason).toBe('length');
      expect(result.httpStatus).toBe(200);
    });

    it('returns empty string when no choices', async () => {
      mockFetch().mockResolvedValueOnce(jsonResponse({ choices: [] }));

      const chat = createOpenAIChatFetcher(BASE_OPTS);
      const result = await chat({ messages: MESSAGES });

      expect(result.content).toBe('');
      expect(result.finishReason).toBeNull();
    });

    it('sends correct authorization header', async () => {
      mockFetch().mockResolvedValueOnce(okCompletion('ok'));

      const chat = createOpenAIChatFetcher(BASE_OPTS);
      await chat({ messages: MESSAGES });

      const headers = mockFetch().mock.calls[0]![1].headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer sk-test-key');
    });

    it('uses custom temperature', async () => {
      mockFetch().mockResolvedValueOnce(okCompletion('warm'));

      const chat = createOpenAIChatFetcher(BASE_OPTS);
      await chat({ messages: MESSAGES, temperature: 0.8 });

      const body = JSON.parse(mockFetch().mock.calls[0]![1].body as string);
      expect(body.temperature).toBe(0.8);
    });

    it('defaults temperature to 0.3', async () => {
      mockFetch().mockResolvedValueOnce(okCompletion('cool'));

      const chat = createOpenAIChatFetcher(BASE_OPTS);
      await chat({ messages: MESSAGES });

      const body = JSON.parse(mockFetch().mock.calls[0]![1].body as string);
      expect(body.temperature).toBe(0.3);
    });
  });
});
