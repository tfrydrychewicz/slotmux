/**
 * Local terminal chatbot for testing slotmux.
 *
 * Attaches the debug inspector so the UI at http://localhost:4200/inspector/
 * reflects every build in real time.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... pnpm chat
 *   OPENAI_API_KEY=sk-... pnpm chat -- --model gpt-4o --budget 8192 --strategy summarize
 */

import { stdin, stdout } from 'node:process';
import * as readline from 'node:readline/promises';

import { attachInspector, type InspectorHandle } from '@slotmux/debug';
import { formatOpenAIMessages, openai } from '@slotmux/providers';
import { Context, createContext, type ParsedContextConfig } from 'slotmux';

// ── CLI args ─────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') continue;
    if (a.startsWith('--') && i + 1 < argv.length) {
      args[a.slice(2)] = argv[++i]!;
    }
  }
  return args;
}

const cli = parseArgs(process.argv.slice(2));

const MODEL = cli['model'] ?? process.env['CHAT_MODEL'] ?? 'gpt-5.4-mini';
const BUDGET = Number(cli['budget'] ?? process.env['CHAT_BUDGET'] ?? '16384');
const STRATEGY = cli['strategy'] ?? process.env['CHAT_STRATEGY'] ?? undefined;
const SYSTEM_PROMPT = cli['system'] ?? 'You are a helpful, concise assistant.';
const INSPECTOR_PORT = Number(cli['inspector-port'] ?? '4200');

// ── Setup ────────────────────────────────────────────────────────────

const OPENAI_KEY = process.env['OPENAI_API_KEY'];
if (!OPENAI_KEY) {
  console.error('\x1b[31mSet OPENAI_API_KEY to run the chatbot.\x1b[0m');
  process.exit(1);
}

const provider = openai({ apiKey: OPENAI_KEY });

const createOpts: Record<string, unknown> = {
  model: MODEL,
  maxTokens: BUDGET,
  preset: 'chat',
  reserveForResponse: 4096,
  lazyContentItemTokens: true,
  slotmuxProvider: provider,
};
if (STRATEGY !== undefined) {
  createOpts['slots'] = {
    history: {
      priority: 50,
      budget: { flex: true },
      defaultRole: 'user',
      position: 'after',
      overflow: STRATEGY,
    },
  };
}
const { config } = createContext(createOpts as Parameters<typeof createContext>[0]);

const parsedConfig: ParsedContextConfig = config;
let ctx = Context.fromParsedConfig(parsedConfig);
ctx.system(SYSTEM_PROMPT);

let inspector: InspectorHandle = await attachInspector(ctx, {
  port: INSPECTOR_PORT,
  allowInNonDevelopment: true,
});

async function resetContext(): Promise<void> {
  await inspector.close();
  ctx = Context.fromParsedConfig(parsedConfig);
  ctx.system(SYSTEM_PROMPT);
  inspector = await attachInspector(ctx, {
    port: INSPECTOR_PORT,
    allowInNonDevelopment: true,
  });
}

// ── Colors ───────────────────────────────────────────────────────────

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

// ── Banner ───────────────────────────────────────────────────────────

console.log();
console.log(bold('  slotmux terminal chat'));
console.log(dim(`  model: ${MODEL}  budget: ${BUDGET}  strategy: ${STRATEGY ?? 'summarize (preset)'}`));
console.log(dim(`  inspector: ${cyan(inspector.url + '/inspector/')}`));
console.log(dim('  type "quit" to exit, "/stats" for context info, "/compress" to force compression, "/clear" to reset'));
console.log();

// ── REPL ─────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: stdin, output: stdout });

let turns = 0;

while (true) {
  const input = await rl.question(green('You: '));
  const trimmed = input.trim();

  if (trimmed.toLowerCase() === 'quit' || trimmed.toLowerCase() === '/quit') {
    break;
  }

  if (trimmed.toLowerCase() === '/stats') {
    const { snapshot } = await ctx.build();
    const meta = snapshot.meta;
    const slotNames = Object.keys(meta.slots);
    console.log();
    console.log(dim('  ── context stats ──'));
    console.log(dim(`  tokens: ${meta.totalTokens} / ${meta.totalBudget} (${(meta.utilization * 100).toFixed(1)}%)`));
    console.log(dim(`  messages: ${snapshot.messages.length}  turns: ${turns}`));
    console.log(dim(`  build time: ${meta.buildTimeMs}ms`));
    for (const name of slotNames) {
      const s = meta.slots[name]!;
      const overflow = s.overflowTriggered ? yellow(' [overflow]') : '';
      console.log(dim(`  slot ${name}: ${s.usedTokens}/${s.budgetTokens} tok, ${s.itemCount} items${overflow}`));
    }
    console.log();
    continue;
  }

  if (trimmed.toLowerCase() === '/compress') {
    console.log(dim('  Compressing context…'));
    const before = await ctx.build();
    const beforeTokens = before.snapshot.meta.totalTokens;
    const { snapshot } = await ctx.build({ overrides: { forceCompress: true } });
    const afterTokens = snapshot.meta.totalTokens;
    const saved = beforeTokens - afterTokens;
    const ratio = beforeTokens > 0 ? ((saved / beforeTokens) * 100).toFixed(1) : '0';
    console.log();
    console.log(dim('  ── compression result ──'));
    console.log(dim(`  before: ${beforeTokens} tok → after: ${afterTokens} tok (${ratio}% reduction)`));
    for (const name of Object.keys(snapshot.meta.slots)) {
      const s = snapshot.meta.slots[name]!;
      console.log(dim(`  slot ${name}: ${s.usedTokens}/${s.budgetTokens} tok, ${s.itemCount} items`));
    }
    if (snapshot.meta.compressions.length > 0) {
      for (const c of snapshot.meta.compressions) {
        console.log(dim(`  compressed ${c.slot}: ${c.beforeTokens} → ${c.afterTokens} tok (${c.itemCount} items)`));
      }
    }
    console.log();
    continue;
  }

  if (trimmed.toLowerCase() === '/clear') {
    await resetContext();
    turns = 0;
    console.log(dim('  History cleared.\n'));
    continue;
  }

  if (trimmed === '') continue;

  ctx.user(trimmed);
  turns++;

  const { snapshot } = await ctx.build();
  const messages = formatOpenAIMessages(snapshot.messages) as Array<{
    role: string;
    content: string;
  }>;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_completion_tokens: 2048,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`\x1b[31mAPI error ${res.status}: ${body}\x1b[0m\n`);
      continue;
    }

    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    const reply = json.choices[0]?.message.content ?? '(no response)';
    ctx.assistant(reply);

    console.log();
    console.log(cyan('Assistant: ') + reply);
    console.log(
      dim(
        `  [ctx: ${snapshot.meta.totalTokens}/${snapshot.meta.totalBudget} tok` +
          ` · ${(snapshot.meta.utilization * 100).toFixed(1)}%` +
          (json.usage ? ` · api: ${json.usage.prompt_tokens}+${json.usage.completion_tokens}` : '') +
          ` · ${snapshot.meta.buildTimeMs}ms]`,
      ),
    );
    console.log();
  } catch (err) {
    console.error(`\x1b[31mFetch error: ${err instanceof Error ? err.message : String(err)}\x1b[0m\n`);
  }
}

rl.close();
await inspector.close();
console.log(dim('Goodbye!'));
process.exit(0);
