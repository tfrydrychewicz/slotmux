#!/usr/bin/env node

/**
 * LLM-as-judge evaluation for LongMemEval benchmark results.
 *
 * Reads a .jsonl results file and evaluates each answer for correctness
 * using an LLM judge, writing an .evaluated.jsonl file.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... LONGMEM_RUN_ID=<id> pnpm bench:longmemeval:evaluate
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BenchmarkRun, EvaluatedRun } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ───────────────────────────────────────────────────────────

const OPENAI_API_KEY = process.env['OPENAI_API_KEY'];
if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is required');
  process.exit(1);
}

const JUDGE_MODEL = process.env['LONGMEM_JUDGE_MODEL'] ?? 'gpt-4o-mini';
const resultsDir = join(__dirname, 'results');

function resolveRunId(): string {
  const explicit = process.env['LONGMEM_RUN_ID'];
  if (explicit) return explicit;

  const files = readdirSync(resultsDir)
    .filter((f) => f.endsWith('.jsonl') && !f.includes('.evaluated.') && !f.startsWith('trace-'))
    .sort()
    .reverse();
  if (files.length === 0) {
    console.error('No result files found. Run the benchmark first.');
    process.exit(1);
  }
  return files[0]!.replace('.jsonl', '');
}

const RUN_ID = resolveRunId();
const inputPath = join(resultsDir, `${RUN_ID}.jsonl`);
const outputPath = join(resultsDir, `${RUN_ID}.evaluated.jsonl`);

if (!existsSync(inputPath)) {
  console.error(`Results file not found: ${inputPath}`);
  process.exit(1);
}

// ── Load already-evaluated rows for resumability ─────────────────────

const evaluatedKeys = new Set<string>();
let existingLines: string[] = [];
if (existsSync(outputPath)) {
  existingLines = readFileSync(outputPath, 'utf-8').trim().split('\n').filter(Boolean);
  for (const line of existingLines) {
    const row = JSON.parse(line) as EvaluatedRun;
    evaluatedKeys.add(`${row.questionId}::${row.strategy}::${String(row.budgetTokens)}`);
  }
  console.log(`Resuming evaluation: ${String(evaluatedKeys.size)} already evaluated`);
}

// ── Load input rows ──────────────────────────────────────────────────

const inputLines = readFileSync(inputPath, 'utf-8').trim().split('\n').filter(Boolean);
const rows: BenchmarkRun[] = inputLines
  .map((line) => JSON.parse(line) as Record<string, unknown>)
  .filter((obj) => obj['_type'] === undefined) as unknown as BenchmarkRun[];
console.log(`Loaded ${String(rows.length)} runs from ${inputPath}`);

// ── Judge helper ─────────────────────────────────────────────────────

const JUDGE_SYSTEM_PROMPT = `You are an evaluation judge. Given a question, the expected answer, and the model's response, determine if the model's response is correct.

Rules:
- The response is correct if it contains the key information from the expected answer, even if phrased differently.
- Minor wording differences are acceptable as long as the factual content matches.
- If the expected answer is a specific value (name, date, number), the response must contain that value.
- If the model says it cannot find the information or does not know, that is incorrect (unless the expected answer also indicates abstention).

Respond with exactly one line: YES or NO, followed by a brief explanation.
Example: YES - The response correctly identifies the restaurant name.
Example: NO - The response mentions a different date than expected.`;

async function judgeAnswer(
  question: string,
  expected: string,
  actual: string,
): Promise<{ correct: boolean; explanation: string }> {
  const userPrompt = [
    `Question: ${question}`,
    `Expected answer: ${expected}`,
    `Model response: ${actual}`,
    '',
    'Is the model response correct? Answer YES or NO with a brief explanation.',
  ].join('\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      messages: [
        { role: 'system', content: JUDGE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Judge API error ${String(res.status)}: ${body}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const reply = data.choices?.[0]?.message?.content ?? '';
  const trimmed = reply.trim();
  const correct = trimmed.toUpperCase().startsWith('YES');
  return { correct, explanation: trimmed };
}

// ── Main evaluation loop ─────────────────────────────────────────────

const outputRows: string[] = [...existingLines];
let evalCount = 0;
let skipCount = 0;

for (const row of rows) {
  const key = `${row.questionId}::${row.strategy}::${String(row.budgetTokens)}`;
  if (evaluatedKeys.has(key)) {
    skipCount++;
    continue;
  }

  evalCount++;

  if (row.modelAnswer.startsWith('[ERROR]')) {
    const evaluated: EvaluatedRun = {
      ...row,
      correct: false,
      judgeExplanation: 'Benchmark run failed with error',
    };
    outputRows.push(JSON.stringify(evaluated));
    console.log(
      `[${String(evalCount + skipCount)}/${String(rows.length)}] ${row.strategy}@${String(row.budgetTokens)} q=${row.questionId} → ERROR (auto-fail)`,
    );
    continue;
  }

  try {
    const { correct, explanation } = await judgeAnswer(
      row.question,
      row.expectedAnswer,
      row.modelAnswer,
    );

    const evaluated: EvaluatedRun = {
      ...row,
      correct,
      judgeExplanation: explanation,
    };
    outputRows.push(JSON.stringify(evaluated));

    console.log(
      `[${String(evalCount + skipCount)}/${String(rows.length)}] ${row.strategy}@${String(row.budgetTokens)} q=${row.questionId} → ${correct ? 'CORRECT' : 'WRONG'}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[${String(evalCount + skipCount)}/${String(rows.length)}] JUDGE FAILED: ${msg}`,
    );
    const evaluated: EvaluatedRun = {
      ...row,
      correct: false,
      judgeExplanation: `[JUDGE ERROR] ${msg}`,
    };
    outputRows.push(JSON.stringify(evaluated));
  }
}

writeFileSync(outputPath, outputRows.join('\n') + '\n');
console.log(`\nEvaluation complete. ${String(evalCount)} evaluated, ${String(skipCount)} skipped.`);
console.log(`Output: ${outputPath}`);
