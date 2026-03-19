/**
 * Helpers for optional peer dependencies and clear {@link TokenizerNotFoundError} messages.
 *
 * @packageDocumentation
 */

import { createRequire } from 'node:module';

import { TokenizerNotFoundError } from 'contextcraft';

const require = createRequire(import.meta.url);

/** @internal */
export function tryRequireTiktoken(): typeof import('tiktoken') {
  try {
    return require('tiktoken') as typeof import('tiktoken');
  } catch (cause) {
    throw new TokenizerNotFoundError(
      'The `tiktoken` package is not installed. Add it to use OpenAI-compatible encodings (cl100k_base, o200k_base): pnpm add tiktoken',
      { cause, context: { peer: 'tiktoken' } },
    );
  }
}

/** @internal */
export function tryRequireAnthropicTokenizer(): typeof import('@anthropic-ai/tokenizer') {
  try {
    return require('@anthropic-ai/tokenizer') as typeof import('@anthropic-ai/tokenizer');
  } catch (cause) {
    throw new TokenizerNotFoundError(
      'The `@anthropic-ai/tokenizer` package is not installed. Add it for Claude token counting: pnpm add @anthropic-ai/tokenizer',
      { cause, context: { peer: '@anthropic-ai/tokenizer' } },
    );
  }
}

export type GptTokenizerEncodingModule = {
  encode: (line: string) => number[];
  decode: (tokens: Iterable<number>) => string;
};

/** @internal */
export function tryRequireGptTokenizerEncoding(
  encoding: 'cl100k_base' | 'o200k_base',
): GptTokenizerEncodingModule {
  try {
    return require(
      `gpt-tokenizer/encoding/${encoding}`,
    ) as GptTokenizerEncodingModule;
  } catch (cause) {
    throw new TokenizerNotFoundError(
      `The \`gpt-tokenizer\` package is not installed (or encoding "${encoding}" is missing). Add it for pure-JS BPE: pnpm add gpt-tokenizer`,
      { cause, context: { peer: 'gpt-tokenizer', encoding } },
    );
  }
}
