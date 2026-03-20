import {
  formatOpenAIMessages,
  formatAnthropicMessages,
} from '@slotmux/providers';
import { createContext, Context } from 'slotmux';

const OPENAI_KEY = process.env['OPENAI_API_KEY'];
const ANTHROPIC_KEY = process.env['ANTHROPIC_API_KEY'];

if (!OPENAI_KEY && !ANTHROPIC_KEY) {
  console.error(
    'Set at least one of OPENAI_API_KEY or ANTHROPIC_API_KEY to run this example.',
  );
  process.exit(1);
}

// Same context content — built once, formatted for different providers
function buildContext() {
  const { config } = createContext({
    model: 'gpt-5.4-mini',
    preset: 'chat',
    reserveForResponse: 4096,
    charTokenEstimateForMissing: true,
  });

  const ctx = Context.fromParsedConfig(config);
  ctx.system('You are a concise assistant. Reply in one paragraph.');
  ctx.user('Explain how a CPU cache works and why it matters for performance.');
  return ctx;
}

async function callOpenAI(
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({ model: 'gpt-5.4-mini', messages, max_tokens: 512 }),
  });
  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return json.choices[0]?.message.content ?? '(no response)';
}

async function callAnthropic(payload: {
  system: string;
  messages: Array<{ role: string; content: unknown }>;
}): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: payload.system,
      messages: payload.messages,
    }),
  });
  const json = (await res.json()) as {
    content: Array<{ text: string }>;
  };
  return json.content[0]?.text ?? '(no response)';
}

// --- Build once, send to both ---
const ctx = buildContext();
const { snapshot } = await ctx.build();

console.log(
  `Context: ${snapshot.meta.totalTokens} tokens, ${snapshot.messages.length} messages\n`,
);

const results: Array<{ provider: string; response: string }> = [];

if (OPENAI_KEY) {
  console.log('Sending to OpenAI (gpt-5.4-mini)...');
  const messages = formatOpenAIMessages(snapshot.messages) as Array<{
    role: string;
    content: string;
  }>;
  const response = await callOpenAI(messages);
  results.push({ provider: 'OpenAI (gpt-5.4-mini)', response });
}

if (ANTHROPIC_KEY) {
  console.log('Sending to Anthropic (claude-sonnet-4)...');
  const payload = formatAnthropicMessages(snapshot.messages) as {
    system: string;
    messages: Array<{ role: string; content: unknown }>;
  };
  const response = await callAnthropic(payload);
  results.push({ provider: 'Anthropic (claude-sonnet-4)', response });
}

console.log('\n--- Results ---\n');
for (const { provider, response } of results) {
  console.log(`[${provider}]`);
  console.log(response);
  console.log();
}
