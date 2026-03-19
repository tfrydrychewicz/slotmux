/**
 * Runtime validation for context configuration (Zod).
 *
 * @packageDocumentation
 */

import { prettifyError, z } from 'zod';

import { InvalidConfigError } from '../errors.js';
import type { TokenAccountant } from '../types/token-accountant.js';

/** Named overflow strategies */
export const slotOverflowNamedSchema = z.enum([
  'truncate',
  'truncate-latest',
  'summarize',
  'sliding-window',
  'semantic',
  'compress',
  'error',
  'fallback-chain',
]);

/** Slot overflow: named strategy or custom function */
export const slotOverflowStrategySchema = z.union([
  slotOverflowNamedSchema,
  z.custom<(...args: unknown[]) => unknown>(
    (val) => typeof val === 'function',
    'Expected overflow strategy string or function',
  ),
]);

const summarizerSchema = z.union([
  z.enum(['builtin:progressive', 'builtin:map-reduce']),
  z.custom<(...args: unknown[]) => unknown>(
    (val) => typeof val === 'function',
    'Expected summarizer preset or function',
  ),
]);

/**
 * Slot budget discriminated shapes.
 * Bounded flex additionally enforces `min <= max`.
 */
export const slotBudgetSchema = z.union([
  z.object({
    fixed: z.number().int().nonnegative(),
  }),
  z.object({
    percent: z.number().min(0).max(100),
  }),
  // Bounded flex must come before plain `{ flex: true }` — otherwise extra
  // `min`/`max` keys are stripped and the object still matches plain flex.
  z
    .object({
      min: z.number().int().nonnegative(),
      max: z.number().int().nonnegative(),
      flex: z.literal(true),
    })
    .refine((d) => d.min <= d.max, {
      message: 'bounded flex: min must be less than or equal to max',
      path: ['max'],
    }),
  z
    .object({
      flex: z.literal(true),
    })
    // Reject `{ min, max, flex }` here so invalid bounded flex cannot fall through
    // after the bounded branch's refine fails.
    .strict(),
]);

/** Overflow sub-config (summarize, semantic, sliding window, compress) */
export const overflowConfigSchema = z
  .object({
    summarizer: summarizerSchema.optional(),
    preserveLastN: z.number().int().nonnegative().optional(),
    summaryBudget: slotBudgetSchema.optional(),
    summarizeThreshold: z.number().int().nonnegative().optional(),
    similarityThreshold: z.number().min(0).max(1).optional(),
    anchorTo: z.unknown().optional(),
    embedFn: z.custom<(...args: unknown[]) => unknown>(
      (val) => val === undefined || typeof val === 'function',
      'Expected function',
    ).optional(),
    windowSize: z.number().int().positive().optional(),
    compressionLevel: z.number().min(0).max(1).optional(),
  })
  .passthrough();

/** Single slot configuration */
export const slotConfigSchema = z
  .object({
    priority: z.number().int().min(1).max(100),
    budget: slotBudgetSchema,
    overflow: slotOverflowStrategySchema.optional(),
    overflowConfig: overflowConfigSchema.optional(),
    position: z.enum(['before', 'after', 'interleave']).optional(),
    order: z.number().optional(),
    maxItems: z.number().int().positive().optional(),
    protected: z.boolean().optional(),
    defaultRole: z
      .enum(['system', 'user', 'assistant', 'tool', 'function'])
      .optional(),
  })
  .strict();

const providerConfigSchema = z
  .object({
    provider: z
      .enum(['openai', 'anthropic', 'google', 'mistral', 'ollama', 'custom'])
      .optional(),
    baseUrl: z.string().optional(),
  })
  .passthrough();

const tokenizerConfigSchema = z.object({
  name: z.string().optional(),
  cache: z.boolean().optional(),
});

const pluginSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
  })
  .passthrough();

/** Root context configuration (structural validation + cross-slot rules) */
export const contextConfigSchema = z
  .object({
    model: z.string().min(1),
    reserveForResponse: z.number().int().nonnegative().optional(),
    maxTokens: z.number().int().positive().optional(),
    slots: z.record(z.string(), slotConfigSchema).optional(),
    provider: providerConfigSchema.optional(),
    plugins: z.array(pluginSchema).optional(),
    onEvent: z.custom<(...args: unknown[]) => unknown>(
      (val) => val === undefined || typeof val === 'function',
      'Expected function',
    ).optional(),
    immutableSnapshots: z.boolean().optional(),
    tokenizer: tokenizerConfigSchema.optional(),
    tokenAccountant: z
      .custom<TokenAccountant | undefined>(
        (val) =>
          val === undefined ||
          (typeof val === 'object' &&
            val !== null &&
            typeof (val as { countItems?: unknown }).countItems === 'function'),
        { message: 'tokenAccountant must be an object with countItems(items) => number' },
      )
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.slots) return;

    let percentSum = 0;
    let fixedSum = 0;

    for (const slot of Object.values(data.slots)) {
      const b = slot.budget;
      if ('percent' in b) {
        percentSum += b.percent;
      }
      if ('fixed' in b) {
        fixedSum += b.fixed;
      }
    }

    if (percentSum > 100) {
      ctx.addIssue({
        code: 'custom',
        message: `Sum of slot percentage budgets (${percentSum}) must not exceed 100`,
        path: ['slots'],
      });
    }

    if (data.maxTokens !== undefined && fixedSum > data.maxTokens) {
      ctx.addIssue({
        code: 'custom',
        message: `Sum of fixed slot budgets (${fixedSum}) must not exceed maxTokens (${data.maxTokens})`,
        path: ['slots'],
      });
    }
  });

export type ParsedContextConfig = z.infer<typeof contextConfigSchema>;

export type ParsedSlotConfig = z.infer<typeof slotConfigSchema>;

export type ParsedSlotBudget = z.infer<typeof slotBudgetSchema>;

/**
 * Validates a single slot configuration (Zod).
 *
 * @param data - Raw slot config object
 * @returns Parsed slot config when valid
 * @throws {@link InvalidConfigError} When validation fails
 */
export function validateSlotConfig(data: unknown): ParsedSlotConfig {
  const result = slotConfigSchema.safeParse(data);
  if (!result.success) {
    const message = prettifyError(result.error);
    throw new InvalidConfigError(message, {
      cause: result.error,
      context: { issues: result.error.issues },
    });
  }
  return result.data;
}

/**
 * Safe parse for a single slot — returns Zod result without throwing.
 */
export function safeParseSlotConfig(data: unknown) {
  return slotConfigSchema.safeParse(data);
}

/**
 * Parses and validates unknown input as {@link ContextConfig}-shaped data.
 *
 * @param data - Raw configuration (e.g. from JSON or user input)
 * @returns Parsed config when valid
 * @throws {@link InvalidConfigError} When validation fails
 */
export function validateContextConfig(data: unknown): ParsedContextConfig {
  const result = contextConfigSchema.safeParse(data);
  if (!result.success) {
    const message = prettifyError(result.error);
    throw new InvalidConfigError(message, {
      cause: result.error,
      context: { issues: result.error.issues },
    });
  }
  return result.data;
}

/**
 * Safe parse — returns success flag instead of throwing.
 */
export function safeParseContextConfig(data: unknown) {
  return contextConfigSchema.safeParse(data);
}
