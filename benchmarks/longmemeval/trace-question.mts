#!/usr/bin/env node

/**
 * Traces the step-by-step context evolution for a single LongMemEval question.
 *
 * For each session added to the context, calls ctx.build() and records the
 * full built context (all messages) plus metadata. Each step is written as
 * one JSONL line, so the output is a complete replay of how slotmux compressed
 * the conversation.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... pnpm bench:longmemeval:trace <question-id> [strategy] [budget]
 *
 * Examples:
 *   pnpm bench:longmemeval:trace e47becba truncate 8192
 *   pnpm bench:longmemeval:trace e47becba summarize 16384
 *   pnpm bench:longmemeval:trace e47becba            # defaults: truncate, 8192
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { Context, validateContextConfig } from 'slotmux';
import { openai, ProviderRateLimitError, OpenAIApiError, type SummarizeTextResult } from '@slotmux/providers';

import type { DatasetEntry } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Args & config ────────────────────────────────────────────────────

const args = process.argv.slice(2);
const questionId = args[0];
if (!questionId) {
  console.error('Usage: pnpm bench:longmemeval:trace <question-id> [strategy] [budget]');
  console.error('  strategy: truncate | truncate-latest | sliding-window | summarize | fallback-chain');
  console.error('  budget:   token budget (default: 8192)');
  process.exit(1);
}

const strategy = args[1] ?? 'truncate';
const budget = Number(args[2] ?? '8192');

const OPENAI_API_KEY = process.env['OPENAI_API_KEY'];
const COMPRESSION_MODEL = process.env['LONGMEM_COMPRESSION_MODEL'] ?? 'gpt-5.4-mini';
const READER_MODEL = process.env['LONGMEM_READER_MODEL'] ?? 'gpt-5.4-mini';
const VERBOSE_SUMMARIZE = process.env['VERBOSE_SUMMARIZE'] === '1';

const needsApiKey = strategy === 'summarize' || strategy === 'fallback-chain';
if (needsApiKey && !OPENAI_API_KEY) {
  console.error(`OPENAI_API_KEY is required for the "${strategy}" strategy`);
  process.exit(1);
}

// ── Load dataset ─────────────────────────────────────────────────────

const dataPath = join(__dirname, 'data', 'longmemeval_s_cleaned.json');
if (!existsSync(dataPath)) {
  console.error(`Dataset not found at ${dataPath}`);
  console.error('Run: pnpm bench:longmemeval:download');
  process.exit(1);
}

const dataset: DatasetEntry[] = JSON.parse(readFileSync(dataPath, 'utf-8'));
const entry = dataset.find((e) => e.question_id === questionId);
if (!entry) {
  console.error(`Question "${questionId}" not found in dataset`);
  console.error(`Available IDs (first 20): ${dataset.slice(0, 20).map((e) => e.question_id).join(', ')}`);
  process.exit(1);
}

// ── Build slot config ────────────────────────────────────────────────

function buildSlotOverflow(s: string): {
  overflow: string;
  overflowConfig?: Record<string, unknown>;
} {
  if (s === 'sliding-window') {
    return { overflow: 'sliding-window', overflowConfig: { windowSize: 20 } };
  }
  return { overflow: s };
}

// ── Run trace ────────────────────────────────────────────────────────

console.log(`Tracing question "${questionId}" with strategy="${strategy}" budget=${String(budget)}`);
console.log(`  Type: ${entry.question_type}`);
console.log(`  Sessions: ${String(entry.haystack_sessions.length)}`);
const totalTurns = entry.haystack_sessions.reduce((sum, s) => sum + s.length, 0);
console.log(`  Total turns: ${String(totalTurns)}`);
console.log();

const systemBudget = 200;
const historyBudget = budget - systemBudget;
const { overflow, overflowConfig } = buildSlotOverflow(strategy);

type SummarizeCallLog = {
  callId: number;
  layer: number;
  targetTokens: number | null;
  inputChars: number;
  outputChars: number;
  elapsedMs: number;
  empty: boolean;
  httpStatus: number | null;
  finishReason: string | null;
  error: string | null;
  promptPreview: string;
  responsePreview: string;
};

let summarizeCallNum = 0;
let pendingSummarizeLogs: SummarizeCallLog[] = [];

function drainSummarizeLogs(): SummarizeCallLog[] {
  const logs = pendingSummarizeLogs;
  pendingSummarizeLogs = [];
  return logs;
}

function buildLoggingProvider(baseUrl: string, model: string, apiKey: string): ReturnType<typeof openai> {
  const provider = openai({ apiKey, compressionModel: model, baseUrl });

  if (!VERBOSE_SUMMARIZE) return provider;

  const originalSummarize = provider.summarizeText!;

  return {
    ...provider,
    summarizeText: async (params) => {
      const callId = ++summarizeCallNum;
      const t0 = performance.now();

      let rawResult: string | SummarizeTextResult;
      try {
        rawResult = await originalSummarize(params);
      } catch (err) {
        const elapsedMs = Math.round(performance.now() - t0);
        let httpStatus: number | null = null;
        let errorText: string;

        if (err instanceof ProviderRateLimitError) {
          httpStatus = err.httpStatus;
          errorText = err.responseBody.slice(0, 1000);
        } else if (err instanceof OpenAIApiError) {
          httpStatus = err.httpStatus;
          errorText = err.message;
        } else {
          errorText = `fetch error: ${err instanceof Error ? err.message : String(err)}`;
        }

        pendingSummarizeLogs.push({
          callId,
          layer: params.layer,
          targetTokens: params.targetTokens ?? null,
          inputChars: params.userPayload.length,
          outputChars: 0,
          elapsedMs,
          empty: true,
          httpStatus,
          finishReason: null,
          error: errorText,
          promptPreview: params.systemPrompt.slice(0, 200),
          responsePreview: '',
        });

        const statusTag = httpStatus !== null ? ` HTTP=${String(httpStatus)}` : '';
        console.log(
          `    [summarize #${String(callId).padStart(3)}] ` +
          `layer=${String(params.layer)} ` +
          `targetTokens=${String(params.targetTokens ?? 'none').padStart(5)} ` +
          `input=${String(params.userPayload.length).padStart(6)} chars ` +
          `FAILED ${String(elapsedMs).padStart(5)}ms${statusTag}`,
        );
        console.log(`      error: ${errorText.slice(0, 200)}`);
        throw err;
      }

      const text = typeof rawResult === 'string' ? rawResult : rawResult.text;
      const finishReason = typeof rawResult === 'string' ? null : rawResult.finishReason ?? null;
      const httpStatus = typeof rawResult === 'string' ? null : rawResult.httpStatus ?? null;

      const elapsedMs = Math.round(performance.now() - t0);
      const empty = text.trim().length === 0;

      pendingSummarizeLogs.push({
        callId,
        layer: params.layer,
        targetTokens: params.targetTokens ?? null,
        inputChars: params.userPayload.length,
        outputChars: text.length,
        elapsedMs,
        empty,
        httpStatus,
        finishReason,
        error: null,
        promptPreview: params.systemPrompt.slice(0, 200),
        responsePreview: text.slice(0, 500),
      });

      const frTag = finishReason !== null ? ` finish=${finishReason}` : '';
      const statusTag = httpStatus !== null ? ` HTTP=${String(httpStatus)}` : '';
      console.log(
        `    [summarize #${String(callId).padStart(3)}] ` +
        `layer=${String(params.layer)} ` +
        `targetTokens=${String(params.targetTokens ?? 'none').padStart(5)} ` +
        `input=${String(params.userPayload.length).padStart(6)} chars ` +
        `output=${String(text.length).padStart(5)} chars ` +
        `${String(elapsedMs).padStart(5)}ms${statusTag}${frTag}` +
        `${empty ? '  ⚠️ EMPTY' : ''}`,
      );
      if (empty || text.length < 20) {
        console.log(`      prompt: ${params.systemPrompt.slice(0, 120)}…`);
        console.log(`      response: ${JSON.stringify(text)}`);
      }
      return rawResult;
    },
  };
}

const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const rawProvider = OPENAI_API_KEY
  ? buildLoggingProvider(OPENAI_BASE_URL, COMPRESSION_MODEL, OPENAI_API_KEY)
  : undefined;

const parsed = validateContextConfig({
  model: READER_MODEL,
  maxTokens: budget,
  reserveForResponse: 0,
  lazyContentItemTokens: true,
  ...(rawProvider !== undefined ? { slotmuxProvider: rawProvider } : {}),
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

const resultsDir = join(__dirname, 'results');
mkdirSync(resultsDir, { recursive: true });
const outPath = join(resultsDir, `trace-${questionId}-${strategy}-${String(budget)}.jsonl`);

// Write header line with question metadata
const header = {
  _type: 'header' as const,
  questionId: entry.question_id,
  questionType: entry.question_type,
  question: entry.question,
  expectedAnswer: entry.answer,
  strategy,
  budgetTokens: budget,
  totalSessions: entry.haystack_sessions.length,
  totalTurns,
};
writeFileSync(outPath, JSON.stringify(header) + '\n');

let stepNum = 0;
let totalTurnsIngested = 0;

async function recordStep(label: string, sessionIndex: number | null, turnsAdded: number): Promise<void> {
  totalTurnsIngested += turnsAdded;
  stepNum++;

  const t0 = performance.now();
  const { snapshot } = await ctx.build();
  const buildTimeMs = performance.now() - t0;

  const meta = snapshot.meta;
  const slotsRecord: Record<string, {
    budgetTokens: number;
    usedTokens: number;
    itemCount: number;
    evictedCount: number;
    overflowTriggered: boolean;
    utilization: number;
  }> = {};
  for (const [name, slotMeta] of Object.entries(meta.slots)) {
    slotsRecord[name] = {
      budgetTokens: Number(slotMeta.budgetTokens),
      usedTokens: Number(slotMeta.usedTokens),
      itemCount: slotMeta.itemCount,
      evictedCount: slotMeta.evictedCount,
      overflowTriggered: slotMeta.overflowTriggered,
      utilization: Number(slotMeta.utilization.toFixed(4)),
    };
  }

  const overflowOccurred = meta.evictions.length > 0 || meta.compressions.length > 0;

  const summarizeCalls = drainSummarizeLogs();

  const line = {
    _type: 'step' as const,
    step: stepNum,
    timestamp: new Date().toISOString(),
    label,
    sessionIndex,
    turnsAdded,
    totalTurnsIngested,
    buildTimeMs: Math.round(buildTimeMs),
    totalTokens: Number(meta.totalTokens),
    totalBudget: Number(meta.totalBudget),
    utilization: Number(meta.utilization.toFixed(4)),
    slots: slotsRecord,
    overflowOccurred,
    compressionCount: meta.compressions.length,
    evictionCount: meta.evictions.length,
    warnings: meta.warnings.map((w) => w.message),
    ...(summarizeCalls.length > 0 ? { summarizeCalls } : {}),
    messages: snapshot.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.name !== undefined ? { name: m.name } : {}),
    })),
  };

  appendFileSync(outPath, JSON.stringify(line) + '\n');

  const histSlot = slotsRecord['history'];
  const overflowFlag = overflowOccurred ? ' [OVERFLOW]' : '';
  const now = new Date();
  const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
  console.log(
    `  [${ts}] Step ${String(stepNum).padStart(3)}: ${label.padEnd(30)} ` +
    `tokens=${String(line.totalTokens).padStart(6)}/${String(line.totalBudget)} ` +
    `util=${(line.utilization * 100).toFixed(1).padStart(5)}% ` +
    `items=${String(histSlot?.itemCount ?? 0).padStart(4)} ` +
    `evicted=${String(histSlot?.evictedCount ?? 0).padStart(4)} ` +
    `build=${String(line.buildTimeMs).padStart(5)}ms` +
    `${overflowFlag}`,
  );
}

// Step 1: system prompt only
await recordStep('system prompt', null, 0);

// Steps 2..N+1: one step per session
for (let si = 0; si < entry.haystack_sessions.length; si++) {
  const session = entry.haystack_sessions[si]!;
  for (const turn of session) {
    if (turn.role === 'user') {
      ctx.user(turn.content);
    } else {
      ctx.assistant(turn.content);
    }
  }
  await recordStep(`session ${String(si + 1)} (${String(session.length)} turns)`, si, session.length);
}

// Final step: append the question
ctx.user(entry.question);
await recordStep('question appended', null, 1);

console.log(`\nTrace written to ${outPath}`);
console.log(`  Lines: ${String(stepNum + 1)} (1 header + ${String(stepNum)} steps)`);
console.log(`  Tip: each JSONL line contains the full "messages" array — the exact context the LLM would see.`);
