import { describe, it, expect } from 'vitest';

import { VERSION } from './index';

describe('@contextcraft/plugin-rag', () => {
  it('exports version', () => {
    expect(VERSION).toBe('0.0.1');
  });
});
