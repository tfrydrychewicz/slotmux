import type { CompiledMessage } from 'contextcraft';
import { describe, expect, it } from 'vitest';

import {
  AnthropicAdapter,
  collapseConsecutiveRoles,
  createAnthropicAdapter,
  formatAnthropicMessages,
} from './anthropic-adapter.js';

describe('formatAnthropicMessages', () => {
  it('extracts system to top-level string', () => {
    const messages: CompiledMessage[] = [
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Hi' },
    ];
    expect(formatAnthropicMessages(messages)).toEqual({
      system: 'Be concise.',
      messages: [{ role: 'user', content: 'Hi' }],
    });
  });

  it('joins multiple system messages', () => {
    const messages: CompiledMessage[] = [
      { role: 'system', content: 'A' },
      { role: 'system', content: 'B' },
      { role: 'user', content: 'Hi' },
    ];
    expect(formatAnthropicMessages(messages).system).toBe('A\n\nB');
  });

  it('maps tool role to user tool_result block', () => {
    const messages: CompiledMessage[] = [
      {
        role: 'tool',
        tool_call_id: 'toolu_01',
        content: '{"x":1}',
      },
    ];
    expect(formatAnthropicMessages(messages)).toEqual({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_01',
              content: '{"x":1}',
            },
          ],
        },
      ],
    });
  });

  it('maps assistant toolUses to tool_use blocks', () => {
    const messages: CompiledMessage[] = [
      {
        role: 'assistant',
        content: 'Calling tool.',
        toolUses: [
          {
            id: 'toolu_1',
            name: 'get_weather',
            input: { city: 'NYC' },
          },
        ],
      },
    ];
    expect(formatAnthropicMessages(messages)).toEqual({
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Calling tool.' },
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'get_weather',
              input: { city: 'NYC' },
            },
          ],
        },
      ],
    });
  });

  it('maps base64 image to Anthropic image source', () => {
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
    expect(formatAnthropicMessages(messages)).toEqual({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: 'QUJD',
              },
            },
          ],
        },
      ],
    });
  });

  it('maps image_url to url source', () => {
    const messages: CompiledMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: 'https://example.com/x.png' },
          },
        ],
      },
    ];
    expect(formatAnthropicMessages(messages)).toEqual({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'url', url: 'https://example.com/x.png' },
            },
          ],
        },
      ],
    });
  });

  it('merges consecutive user messages', () => {
    const messages: CompiledMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ];
    expect(formatAnthropicMessages(messages)).toEqual({
      messages: [{ role: 'user', content: 'ab' }],
    });
  });
});

describe('collapseConsecutiveRoles', () => {
  it('merges same-role blocks', () => {
    const merged = collapseConsecutiveRoles([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ]);
    expect(merged).toEqual([{ role: 'user', content: 'ab' }]);
  });
});

describe('AnthropicAdapter', () => {
  it('implements ProviderAdapter', () => {
    const a = createAnthropicAdapter();
    expect(a.id).toBe('anthropic');
    expect(a.resolveModel('claude-sonnet-4-20250514').maxContextTokens).toBe(
      200_000,
    );
    const out = a.formatMessages([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'U' },
    ]) as ReturnType<AnthropicAdapter['formatMessages']>;
    expect(out.system).toBe('S');
    expect(out.messages).toEqual([{ role: 'user', content: 'U' }]);
    expect(a.getTokenizer('claude-3-5-haiku-20241022').id).toBeDefined();
  });
});
