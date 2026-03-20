import { describe, expect, it } from 'vitest';

import { compileContentItem } from '../../src/content/compile-content-item.js';
import { createContentItem } from '../../src/content/content-store.js';

describe('compileContentItem', () => {
  it('maps string content and tool metadata', () => {
    const item = createContentItem({
      slot: 'h',
      role: 'user',
      content: 'hi',
      name: 'u1',
      toolCallId: 'call-1',
    });
    expect(compileContentItem(item)).toEqual({
      role: 'user',
      content: 'hi',
      name: 'u1',
      tool_call_id: 'call-1',
    });
  });
});
