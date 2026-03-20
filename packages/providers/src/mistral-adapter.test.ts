import type { CompiledMessage } from 'slotmux';
import { describe, expect, it } from 'vitest';

import {
  createMistralAdapter,
  formatMistralMessages,
  MistralAdapter,
} from './mistral-adapter.js';

describe('formatMistralMessages', () => {
  it('matches OpenAI-compatible chat shape', () => {
    const messages: CompiledMessage[] = [
      { role: 'system', content: 'Sys' },
      { role: 'user', content: 'Hi' },
    ];
    expect(formatMistralMessages(messages)).toEqual([
      { role: 'system', content: 'Sys' },
      { role: 'user', content: 'Hi' },
    ]);
  });

  it('formats tool and multimodal like OpenAI chat', () => {
    const messages: CompiledMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'See' },
          {
            type: 'image_url',
            image_url: { url: 'https://x.test/i.png' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'abc',
        content: '{}',
      },
    ];
    const out = formatMistralMessages(messages);
    expect(out[0]).toMatchObject({ role: 'user' });
    expect(out[1]).toEqual({
      role: 'tool',
      tool_call_id: 'abc',
      content: '{}',
    });
  });
});

describe('MistralAdapter', () => {
  it('uses mistral provider and delegates formatting', () => {
    const a: MistralAdapter = createMistralAdapter();
    expect(a.id).toBe('mistral');
    expect(a.resolveModel('mistral-large-latest').maxContextTokens).toBe(128_000);
    expect(
      a.formatMessages([{ role: 'user', content: 'x' }]),
    ).toEqual([{ role: 'user', content: 'x' }]);
    expect(a.getTokenizer('mistral-large-latest').id).toBeDefined();
  });
});
