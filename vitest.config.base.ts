import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Prefer `development` package exports (e.g. contextcraft → src/) so tests run without a prior build.
  resolve: {
    conditions: ['development', 'import', 'module', 'default'],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', '__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    benchmark: {
      include: ['**/*.bench.ts'],
    },
  },
});
