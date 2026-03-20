import { describe, expect, it } from 'vitest';

import { ragPlugin, VERSION } from './index.js';

describe('@slotmux/plugin-rag', () => {
  it('exports version', () => {
    expect(VERSION).toBe('0.0.1');
  });

  it('ragPlugin exposes name and getRagCitations', () => {
    const p = ragPlugin();
    expect(p.name).toContain('plugin-rag');
    expect(p.getRagCitations()).toEqual([]);
  });
});
