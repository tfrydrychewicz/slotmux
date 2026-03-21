#!/usr/bin/env node

/**
 * LongMemEval benchmark runner for slotmux.
 *
 * Feeds LongMemEval chat histories through slotmux with various overflow
 * strategies and budget constraints, then queries an LLM for answers.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... pnpm bench:longmemeval
 *
 * See benchmarks/longmemeval/README.md for all env vars.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { Context, validateContextConfig } from 'slotmux';
import { openai, formatOpenAIMessages } from '@slotmux/providers';

import type { DatasetEntry, BenchmarkRun } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config from env ──────────────────────────────────────────────────

const OPENAI_API_KEY = process.env['OPENAI_API_KEY'];
if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is required');
  process.exit(1);
}

const READER_MODEL = process.env['LONGMEM_READER_MODEL'] ?? 'gpt-5.4-mini';
const COMPRESSION_MODEL = process.env['LONGMEM_COMPRESSION_MODEL'] ?? 'gpt-5.4-mini';
const BUDGETS = (process.env['LONGMEM_BUDGETS'] ?? '4096,8192,16384,32768')
  .split(',')
  .map((s) => Number(s.trim()));
const STRATEGIES = (
  process.env['LONGMEM_STRATEGIES'] ??
  'truncate,truncate-latest,sliding-window,summarize,fallback-chain'
)
  .split(',')
  .map((s) => s.trim());
const MAX_QUESTIONS = Number(process.env['LONGMEM_MAX_QUESTIONS'] ?? '500');
const RUN_ID = process.env['LONGMEM_RUN_ID'] ?? new Date().toISOString().replace(/[:.]/g, '-');

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
    const row = JSON.parse(line) as BenchmarkRun;
    completed.add(`${row.questionId}::${row.strategy}::${String(row.budgetTokens)}`);
  }
  console.log(`Resuming: ${String(completed.size)} runs already completed`);
}

// ── LLM helper ───────────────────────────────────────────────────────

type ChatMessage = { role: string; content: string };

async function callOpenAI(messages: ChatMessage[], model: string): Promise<string> {
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

const provider = openai({ apiKey: OPENAI_API_KEY, compressionModel: COMPRESSION_MODEL });

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
        };

        appendFileSync(resultsPath, JSON.stringify(result) + '\n');
        completed.add(key);

        console.log(
          `${progress} ${strategy}@${String(budget)} q=${entry.question_id} ` +
          `tokens=${String(result.actualTokens)} build=${String(result.buildTimeMs)}ms`,
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
        };
        appendFileSync(resultsPath, JSON.stringify(failResult) + '\n');
        completed.add(key);
      }
    }
  }
}

console.log(`\nDone. ${String(runCount)} new runs, ${String(skipCount)} skipped (already complete).`);
console.log(`Results: ${resultsPath}`);
