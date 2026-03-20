import { defineConfig } from 'vitest/config';

import baseConfig from '../../vitest.config.base';

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: [
      'src/**/*.test.ts',
      '__tests__/unit/**/*.test.ts',
      '__tests__/types/**/*.test.ts',
      '__tests__/integration/**/*.test.ts',
      '__tests__/property/**/*.test.ts',
      '__tests__/e2e/**/*.test.ts',
    ],
    benchmark: {
      include: ['__tests__/benchmarks/**/*.bench.ts'],
    },
  },
});
