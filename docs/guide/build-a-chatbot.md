# Build a terminal chatbot with context management

This tutorial builds a **fully working interactive terminal chatbot** that talks to the OpenAI API. Along the way it demonstrates the key features of slotmux: slot-based context assembly, token budgeting, overflow awareness, provider formatting, and snapshot metadata.

**Time:** ~5 minutes to read, ~2 minutes to run.

**You will end up with:**

- An interactive REPL chat in your terminal.
- A `Context` with a **system** slot (pinned instructions) and a **history** slot (user/assistant turns, auto-managed budget).
- Every turn: `build()` → **token count** → **overflow check** → **`formatOpenAIMessages()`** → OpenAI API call.
- A metadata bar printed after every response showing utilization, token counts, and per-slot stats.

## Prerequisites

- **Node.js ≥ 20.19**
- An **OpenAI API key** (set as `OPENAI_API_KEY` env var)

## 1. Bootstrap the project

```bash
mkdir cc-chatbot && cd cc-chatbot
npm init -y
```

Install slotmux and a tokenizer:

```bash
npm install slotmux @slotmux/providers
```

For accurate token counting (recommended for production), add a tokenizer:

```bash
npm install gpt-tokenizer
```

Enable ESM (slotmux is ESM-only):

```bash
node -e "const p=require('./package.json'); p.type='module'; require('fs').writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
```

## 2. The full chatbot — `chat.mjs`

Create a file called **`chat.mjs`** and paste the code below. Every section is annotated so you can follow what slotmux is doing.

```javascript
import * as readline from 'node:readline';
import { createContext, Context } from 'slotmux';
import { openai, formatOpenAIMessages } from '@slotmux/providers';

// ── 1. Check for API key early ───────────────────────────────────────

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('Set OPENAI_API_KEY before running this script.');
  process.exit(1);
}

// ── 2. Create a validated context config ─────────────────────────────
//
// `createContext` resolves the model registry (maxTokens, tokenizer,
// provider), merges the "chat" preset slots, and validates everything.
// The "chat" preset gives you two slots:
//   • system  — priority 100, fixed 2 000 tokens, overflow: error
//   • history — priority 50,  flex budget,        overflow: summarize
//
// `slotmuxProvider: openai(...)` auto-wires summarization so that when
// the history slot overflows, slotmux calls the OpenAI API to compress
// older messages automatically — no manual wiring needed.

const { config } = createContext({
  model: 'gpt-5.4-mini',
  preset: 'chat',
  reserveForResponse: 4096,
  lazyContentItemTokens: true,
  slotmuxProvider: openai({ apiKey: OPENAI_API_KEY }),
});

// ── 3. Build a live Context from the config ──────────────────────────
//
// Context is a mutable container: you push messages, then call build()
// to get an immutable snapshot with compiled messages + metadata.

const ctx = Context.fromParsedConfig(config);

ctx.system(
  'You are a helpful assistant. Answer concisely. ' +
  'If the user says "!stats", respond with context window statistics instead.'
);

// ── 4. Helper: call OpenAI Chat Completions ──────────────────────────

async function callOpenAI(messages) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: 'gpt-5.4-mini', messages }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '(no response)';
}

// ── 5. Helper: print context metadata ────────────────────────────────

function printMeta(meta) {
  const pct = (meta.utilization * 100).toFixed(1);
  const slots = Object.entries(meta.slots)
    .map(([name, s]) => `${name}: ${s.usedTokens}/${s.budgetTokens} tok, ${s.itemCount} items`)
    .join(' | ');

  console.log(
    `\n  ╭─ Context ──────────────────────────────────────`
  );
  console.log(
    `  │ tokens: ${meta.totalTokens} / ${meta.totalBudget}  ` +
    `utilization: ${pct}%  build: ${meta.buildTimeMs}ms`
  );
  console.log(`  │ ${slots}`);
  if (meta.warnings.length > 0) {
    console.log(`  │ ⚠ warnings: ${meta.warnings.map(w => w.message).join('; ')}`);
  }
  console.log(
    `  ╰────────────────────────────────────────────────\n`
  );
}

// ── 6. REPL loop ─────────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log('slotmux chatbot — type a message, "!stats" for context info, or "exit" to quit.\n');

function prompt() {
  rl.question('You > ', async (input) => {
    const text = input.trim();
    if (!text || text === 'exit') {
      rl.close();
      return;
    }

    // Push user message into the history slot
    ctx.user(text);

    // Build: budget allocation → token counting → overflow → compile
    const { snapshot } = await ctx.build();

    // Handle !stats: show metadata and skip the API call
    if (text === '!stats') {
      console.log('\nAssistant > Here are your current context stats:');
      printMeta(snapshot.meta);
      prompt();
      return;
    }

    // Format compiled messages for the OpenAI Chat Completions API
    const openaiMessages = formatOpenAIMessages(snapshot.messages);

    try {
      const reply = await callOpenAI(openaiMessages);
      console.log(`\nAssistant > ${reply}`);

      // Push assistant reply back into context for next turn
      ctx.assistant(reply);

      // Print the context metadata bar
      printMeta(snapshot.meta);
    } catch (err) {
      console.error(`\nError: ${err.message}\n`);
    }

    prompt();
  });
}

prompt();
```

## 3. Run it

```bash
OPENAI_API_KEY=sk-... node chat.mjs
```

You'll see something like:

```
slotmux chatbot — type a message, "!stats" for context info, or "exit" to quit.

You > What can you help me with?

Assistant > I can help with coding questions, writing, math, brainstorming, and more.

  ╭─ Context ──────────────────────────────────────
  │ tokens: 67 / 124904  utilization: 0.1%  build: 2ms
  │ system: 25/2000 tok, 1 items | history: 42/122904 tok, 2 items
  ╰────────────────────────────────────────────────

You > !stats

Assistant > Here are your current context stats:

  ╭─ Context ──────────────────────────────────────
  │ tokens: 72 / 124904  utilization: 0.1%  build: 1ms
  │ system: 25/2000 tok, 1 items | history: 47/122904 tok, 3 items
  ╰────────────────────────────────────────────────

You > exit
```

## 4. What happened under the hood

Each time you type a message, slotmux does all of this before the API call:

1. **`ctx.user(text)`** — Appends a `ContentItem` to the **history** slot.
2. **`ctx.build()`** — Runs the full compile pipeline:
   - **Budget allocation** — The **system** slot gets its fixed 2 000 tokens; the **history** slot fills the remaining flex budget.
   - **Token counting** — `lazyContentItemTokens: true` means the pipeline lazily counts each message via the installed `gpt-tokenizer` on first build, then caches the result.
   - **Overflow check** — If history grows past its budget, the configured overflow strategy kicks in. Because we set `slotmuxProvider: openai(...)`, the `summarize` strategy automatically calls the OpenAI API (using a cheap model like `gpt-5.4-mini`) to compress older messages.
   - **Compile** — Produces an immutable `ContextSnapshot` containing `messages` (slotmux's internal format) and `meta` (token counts, utilization, per-slot stats, warnings, build time).
3. **`formatOpenAIMessages(snapshot.messages)`** — Converts slotmux's compiled messages into OpenAI's `{ role, content }` shape with multimodal and tool-call support.
4. **`ctx.assistant(reply)`** — Stores the model's reply so it's in scope for the next build.

## 5. Key features demonstrated

| Feature | Where |
| --- | --- |
| **Model registry** | `createContext({ model: 'gpt-5.4-mini' })` resolves maxTokens, tokenizer, provider from the built-in registry. |
| **Preset slots** | `preset: 'chat'` creates `system` (fixed budget) + `history` (flex budget) automatically. |
| **Mutable Context** | `ctx.user()` / `ctx.assistant()` append to the right slots; the context grows turn by turn. |
| **Immutable snapshot** | `ctx.build()` produces a frozen `ContextSnapshot` — safe to cache, serialize, or diff. |
| **Lazy token counting** | `lazyContentItemTokens: true` auto-counts tokens via the model's tokenizer peer (`gpt-tokenizer`) on each build, caching results. |
| **Token budgeting** | `reserveForResponse: 4096` leaves room for the model reply; the rest is split across slots. |
| **Overflow** | The history slot uses `overflow: 'summarize'` — as the conversation grows past the budget, older messages are compressed automatically via the configured `slotmuxProvider`. |
| **Provider factory** | `slotmuxProvider: openai({ apiKey })` auto-wires summarization — no manual `progressiveSummarize` setup needed. |
| **Provider formatting** | `formatOpenAIMessages()` handles text, multimodal, and tool messages for OpenAI's API shape. |
| **Metadata** | `snapshot.meta` — `totalTokens`, `utilization`, per-slot breakdown, `warnings`, `buildTimeMs`. |

## Next steps

- **[Getting started](./getting-started)** — minimal install, zero-API snippet.
- **[API reference](/reference/api/README)** — full exported symbols.
- Swap `preset: 'chat'` for `preset: 'rag'` or `preset: 'agent'` to explore RAG and tool-calling layouts.
- Add `@slotmux/debug` and `attachInspector(ctx)` for a browser-based inspector UI.
