import { describe, expect, it } from 'vitest';

import { InMemoryMemoryStore, memoryPlugin, VERSION } from './index.js';

describe('@contextcraft/plugin-memory', () => {
  it('exports version', () => {
    expect(VERSION).toBe('0.0.1');
  });

  it('memoryPlugin exposes plugin name', () => {
    const p = memoryPlugin({ store: new InMemoryMemoryStore() });
    expect(p.name).toContain('plugin-memory');
    expect(p.prepareSlots).toBeDefined();
  });
});
