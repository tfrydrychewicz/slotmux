import type { CompiledMessage } from 'slotmux';
import { describe, expect, it } from 'vitest';


import {
  createOpenAIAdapter,
  formatOpenAIMessages,
  OpenAIAdapter,
  orderSystemMessagesFirst,
} from './openai-adapter.js';

describe('formatOpenAIMessages', () => {
  it('formats plain user message', () => {
    const messages: CompiledMessage[] = [{ role: 'user', content: 'Hello' }];
    expect(formatOpenAIMessages(messages)).toEqual([
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('places system messages before others', () => {
    const messages: CompiledMessage[] = [
      { role: 'user', content: 'Hi' },
      { role: 'system', content: 'You are helpful.' },
      { role: 'assistant', content: 'Hey.' },
    ];
    const out = formatOpenAIMessages(messages);
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
    expect(out[0]).toEqual({ role: 'system', content: 'You are helpful.' });
  });

  it('preserves relative order of multiple system messages', () => {
    const ordered = orderSystemMessagesFirst([
      { role: 'user', content: 'u' },
      { role: 'system', content: 'first' },
      { role: 'system', content: 'second' },
    ]);
    expect(ordered.map((m) => m.role)).toEqual(['system', 'system', 'user']);
    expect(ordered[0]?.content).toBe('first');
    expect(ordered[1]?.content).toBe('second');
  });

  it('includes optional name for user', () => {
    const messages: CompiledMessage[] = [
      { role: 'user', content: 'Yo', name: 'bob' },
    ];
    expect(formatOpenAIMessages(messages)).toEqual([
      { role: 'user', content: 'Yo', name: 'bob' },
    ]);
  });

  it('formats tool role with tool_call_id and stringifies multimodal to text', () => {
    const messages: CompiledMessage[] = [
      {
        role: 'tool',
        tool_call_id: 'call_abc',
        content: [{ type: 'text', text: '{"ok":true}' }],
      },
    ];
    expect(formatOpenAIMessages(messages)).toEqual([
      {
        role: 'tool',
        tool_call_id: 'call_abc',
        content: '{"ok":true}',
      },
    ]);
  });

  it('uses empty tool_call_id when missing (caller should set tool_call_id)', () => {
    const messages: CompiledMessage[] = [
      { role: 'tool', content: 'result' } as CompiledMessage,
    ];
    expect(formatOpenAIMessages(messages)[0]).toMatchObject({
      role: 'tool',
      tool_call_id: '',
      content: 'result',
    });
  });

  it('formats legacy function role', () => {
    const messages: CompiledMessage[] = [
      { role: 'function', name: 'get_weather', content: '{"temp":72}' },
    ];
    expect(formatOpenAIMessages(messages)).toEqual([
      {
        role: 'function',
        name: 'get_weather',
        content: '{"temp":72}',
      },
    ]);
  });

  it('defaults function name when missing', () => {
    const messages: CompiledMessage[] = [
      { role: 'function', content: '{}' } as CompiledMessage,
    ];
    expect(formatOpenAIMessages(messages)[0]).toMatchObject({
      role: 'function',
      name: 'function',
      content: '{}',
    });
  });

  it('maps image_url parts to OpenAI shape', () => {
    const messages: CompiledMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look' },
          {
            type: 'image_url',
            image_url: { url: 'https://x.test/p.png', detail: 'low' },
          },
        ],
      },
    ];
    expect(formatOpenAIMessages(messages)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look' },
          {
            type: 'image_url',
            image_url: { url: 'https://x.test/p.png', detail: 'low' },
          },
        ],
      },
    ]);
  });

  it('maps image_base64 to data URL image_url', () => {
    const messages: CompiledMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'image_base64',
            image_base64: { data: 'QUJD', mime_type: 'image/jpeg' },
          },
        ],
      },
    ];
    expect(formatOpenAIMessages(messages)).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: 'data:image/jpeg;base64,QUJD' },
          },
        ],
      },
    ]);
  });
});

describe('OpenAIAdapter', () => {
  it('implements ProviderAdapter surface', () => {
    const adapter: OpenAIAdapter = createOpenAIAdapter();
    expect(adapter.id).toBe('openai');
    expect(adapter.resolveModel('gpt-4o').tokenizerName).toBe('o200k_base');
    expect(adapter.resolveModel('gpt-4').tokenizerName).toBe('cl100k_base');
    const formatted = adapter.formatMessages([
      { role: 'user', content: 'Hi' },
    ]) as ReturnType<OpenAIAdapter['formatMessages']>;
    expect(formatted).toEqual([{ role: 'user', content: 'Hi' }]);
    expect(adapter.getTokenizer('gpt-4o').id).toBeDefined();
    expect(adapter.calculateOverhead([{ role: 'user', content: 'x' }])).toBeDefined();
  });
});
