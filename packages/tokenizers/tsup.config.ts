import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  // ESM only: `createRequire(import.meta.url)` in load-peer is unreliable in bundled CJS.
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  external: [
    'slotmux',
    'tiktoken',
    '@anthropic-ai/tokenizer',
    'gpt-tokenizer',
  ],
});
