import { describe, it, expect } from 'vitest';

import { VERSION } from './index';

describe('@contextcraft/providers', () => {
  it('exports version', () => {
    expect(VERSION).toBe('0.0.1');
  });
});
