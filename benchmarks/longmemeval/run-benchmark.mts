#!/usr/bin/env node

/**
 * LongMemEval benchmark runner for slotmux.
 *
 * Feeds LongMemEval chat histories through slotmux with various overflow
 * strategies and budget constraints, then queries an LLM for answers.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... pnpm bench:longmemeval
 *   OPENAI_API_KEY=sk-... pnpm bench:longmemeval -- --strategy summarize
 *   OPENAI_API_KEY=sk-... pnpm bench:longmemeval -- --strategy summarize --budget 16384
 *
 * CLI flags override env vars. Multiple values use commas: --strategy summarize,truncate
 *
 * See benchmarks/longmemeval/README.md for all env vars.
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { openai, formatOpenAIMessages } from '@slotmux/providers';
import { Context, validateContextConfig } from 'slotmux';

import type { DatasetEntry, BenchmarkRun } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI arg parser ───────────────────────────────────────────────────

function parseCliArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') continue;
    if (arg.startsWith('--') && i + 1 < argv.length) {
      args[arg.slice(2)] = argv[++i]!;
    }
  }
  return args;
}

const cli = parseCliArgs(process.argv.slice(2));

// ── Config from CLI flags → env vars ─────────────────────────────────

const OPENAI_API_KEY = process.env['OPENAI_API_KEY'];
if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is required');
  process.exit(1);
}

const READER_MODEL = cli['model'] ?? process.env['LONGMEM_READER_MODEL'] ?? 'gpt-5.4-mini';
const COMPRESSION_MODEL = cli['compression-model'] ?? process.env['LONGMEM_COMPRESSION_MODEL'] ?? 'gpt-5.4-mini';
const BUDGETS = (cli['budget'] ?? process.env['LONGMEM_BUDGETS'] ?? '4096,8192,16384,32768')
  .split(',')
  .map((s) => Number(s.trim()));
const STRATEGIES = (
  cli['strategy'] ?? process.env['LONGMEM_STRATEGIES'] ??
  'truncate,truncate-latest,sliding-window,summarize,fallback-chain'
)
  .split(',')
  .map((s) => s.trim());
const MAX_QUESTIONS = Number(cli['max-questions'] ?? process.env['LONGMEM_MAX_QUESTIONS'] ?? '500');
const RUN_ID = cli['run-id'] ?? process.env['LONGMEM_RUN_ID'] ?? new Date().toISOString().replace(/[:.]/g, '-');

// ── Load dataset ─────────────────────────────────────────────────────

const dataPath = join(__dirname, 'data', 'longmemeval_s_cleaned.json');
if (!existsSync(dataPath)) {
  console.error(`Dataset not found at ${dataPath}`);
  console.error('Run: pnpm bench:longmemeval:download');
  process.exit(1);
}

const dataset: DatasetEntry[] = JSON.parse(readFileSync(dataPath, 'utf-8'));
const questions = dataset.slice(0, MAX_QUESTIONS);
console.log(`Loaded ${questions.length} questions from LongMemEval_S`);

// ── Results file (JSONL, resumable) ──────────────────────────────────

const resultsDir = join(__dirname, 'results');
mkdirSync(resultsDir, { recursive: true });
const resultsPath = join(resultsDir, `${RUN_ID}.jsonl`);

const completed = new Set<string>();
if (existsSync(resultsPath)) {
  const lines = readFileSync(resultsPath, 'utf-8').trim().split('\n').filter(Boolean);
  for (const line of lines) {
    const row = JSON.parse(line) as Record<string, unknown>;
    if (row['_type'] !== undefined) continue;
    const run = row as unknown as BenchmarkRun;
    completed.add(`${run.questionId}::${run.strategy}::${String(run.budgetTokens)}`);
  }
  console.log(`Resuming: ${String(completed.size)} runs already completed`);
}

// ── LLM usage tracking ───────────────────────────────────────────────

type ChatMessage = { role: string; content: string };

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessagesTokens(messages: readonly ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m.content) + 4;
  }
  return total;
}

let runLlmRequests = 0;
let runLlmTokensSent = 0;

let globalLlmRequests = 0;
let globalLlmTokensSent = 0;

function resetRunCounters(): void {
  runLlmRequests = 0;
  runLlmTokensSent = 0;
}

function recordLlmCall(tokensSent: number): void {
  runLlmRequests++;
  runLlmTokensSent += tokensSent;
  globalLlmRequests++;
  globalLlmTokensSent += tokensSent;
}

// ── LLM helper ───────────────────────────────────────────────────────

async function callOpenAI(messages: ChatMessage[], model: string): Promise<string> {
  const tokensSent = estimateMessagesTokens(messages);
  recordLlmCall(tokensSent);

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model, messages, temperature: 0 }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${String(res.status)}: ${body}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? '(no response)';
}

// ── Slot config builder ──────────────────────────────────────────────

function buildSlotOverflow(strategy: string): {
  overflow: string;
  overflowConfig?: Record<string, unknown>;
} {
  if (strategy === 'sliding-window') {
    return { overflow: 'sliding-window', overflowConfig: { windowSize: 20 } };
  }
  return { overflow: strategy };
}

// ── Main loop ────────────────────────────────────────────────────────

const totalRuns = questions.length * STRATEGIES.length * BUDGETS.length;
let runCount = 0;
let skipCount = 0;

console.log(`\nBenchmark matrix: ${String(STRATEGIES.length)} strategies × ${String(BUDGETS.length)} budgets × ${String(questions.length)} questions = ${String(totalRuns)} runs`);
console.log(`Run ID: ${RUN_ID}\n`);

const rawProvider = openai({ apiKey: OPENAI_API_KEY, compressionModel: COMPRESSION_MODEL });

const provider: typeof rawProvider = {
  ...rawProvider,
  ...(rawProvider.summarizeText !== undefined
    ? {
        summarizeText: async (params) => {
          const tokensSent = estimateTokens(params.systemPrompt) + estimateTokens(params.userPayload) + 4;
          recordLlmCall(tokensSent);
          return rawProvider.summarizeText!(params);
        },
      }
    : {}),
};

for (const strategy of STRATEGIES) {
  for (const budget of BUDGETS) {
    for (const entry of questions) {
      const key = `${entry.question_id}::${strategy}::${String(budget)}`;
      if (completed.has(key)) {
        skipCount++;
        continue;
      }

      runCount++;
      const progress = `[${String(runCount + skipCount)}/${String(totalRuns)}]`;
      resetRunCounters();

      try {
        const systemBudget = 200;
        const historyBudget = budget - systemBudget;

        const { overflow, overflowConfig } = buildSlotOverflow(strategy);

        const parsed = validateContextConfig({
          model: READER_MODEL,
          maxTokens: budget,
          reserveForResponse: 0,
          lazyContentItemTokens: true,
          slotmuxProvider: provider,
          slots: {
            system: {
              priority: 100,
              budget: { fixed: systemBudget },
              defaultRole: 'system' as const,
              position: 'before' as const,
              overflow: 'error' as const,
              protected: true,
            },
            history: {
              priority: 50,
              budget: { fixed: historyBudget },
              defaultRole: 'user' as const,
              position: 'after' as const,
              overflow,
              ...(overflowConfig !== undefined ? { overflowConfig } : {}),
            },
          },
        });

        const ctx = Context.fromParsedConfig(parsed);
        ctx.system(
          'You are an assistant with access to a user\'s chat history. ' +
          'Answer the question based on the conversation history provided.',
        );

        for (const session of entry.haystack_sessions) {
          for (const turn of session) {
            if (turn.role === 'user') {
              ctx.user(turn.content);
            } else {
              ctx.assistant(turn.content);
            }
          }
        }

        ctx.user(entry.question);

        const t0 = performance.now();
        const { snapshot } = await ctx.build();
        const buildTimeMs = performance.now() - t0;

        const openaiMessages = formatOpenAIMessages(snapshot.messages) as ChatMessage[];
        const modelAnswer = await callOpenAI(openaiMessages, READER_MODEL);

        const result: BenchmarkRun = {
          questionId: entry.question_id,
          questionType: entry.question_type,
          strategy,
          budgetTokens: budget,
          actualTokens: Number(snapshot.meta.totalTokens),
          buildTimeMs: Math.round(buildTimeMs),
          question: entry.question,
          expectedAnswer: entry.answer,
          modelAnswer,
          llmRequests: runLlmRequests,
          llmTokensSent: runLlmTokensSent,
        };

        appendFileSync(resultsPath, JSON.stringify(result) + '\n');
        completed.add(key);

        console.log(
          `${progress} ${strategy}@${String(budget)} q=${entry.question_id} ` +
          `tokens=${String(result.actualTokens)} build=${String(result.buildTimeMs)}ms ` +
          `llm_reqs=${String(runLlmRequests)} llm_tokens_sent=${String(runLlmTokensSent)}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${progress} FAILED ${strategy}@${String(budget)} q=${entry.question_id}: ${msg}`);

        const failResult: BenchmarkRun = {
          questionId: entry.question_id,
          questionType: entry.question_type,
          strategy,
          budgetTokens: budget,
          actualTokens: 0,
          buildTimeMs: 0,
          question: entry.question,
          expectedAnswer: entry.answer,
          modelAnswer: `[ERROR] ${msg}`,
          llmRequests: runLlmRequests,
          llmTokensSent: runLlmTokensSent,
        };
        appendFileSync(resultsPath, JSON.stringify(failResult) + '\n');
        completed.add(key);
      }
    }
  }
}

const llmUsageSummary = {
  _type: 'llm-usage-summary' as const,
  totalLlmRequests: globalLlmRequests,
  totalLlmTokensSent: globalLlmTokensSent,
  totalRuns: runCount,
  skippedRuns: skipCount,
};
appendFileSync(resultsPath, JSON.stringify(llmUsageSummary) + '\n');

console.log(`\nDone. ${String(runCount)} new runs, ${String(skipCount)} skipped (already complete).`);
console.log(`Total LLM requests: ${String(globalLlmRequests)}`);
console.log(`Total LLM tokens sent (estimated): ${String(globalLlmTokensSent)}`);
console.log(`Results: ${resultsPath}`);
