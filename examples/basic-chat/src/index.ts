import { stdin, stdout } from 'node:process';
import * as readline from 'node:readline/promises';

import { formatOpenAIMessages } from '@slotmux/providers';
import { createContext, Context } from 'slotmux';

const OPENAI_KEY = process.env['OPENAI_API_KEY'];
if (!OPENAI_KEY) {
  console.error('Set OPENAI_API_KEY to run this example.');
  process.exit(1);
}

const { config } = createContext({
  model: 'gpt-5.4-mini',
  preset: 'chat',
  reserveForResponse: 4096,
  lazyContentItemTokens: true,
});

const ctx = Context.fromParsedConfig(config);
ctx.system('You are a helpful assistant. Keep answers concise.');

const rl = readline.createInterface({ input: stdin, output: stdout });

console.log('Slotmux basic chat (type "quit" to exit)\n');

while (true) {
  const input = await rl.question('You: ');
  if (input.trim().toLowerCase() === 'quit') break;

  ctx.user(input);

  const { snapshot } = await ctx.build();
  const messages = formatOpenAIMessages(snapshot.messages) as Array<{
    role: string;
    content: string;
  }>;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({ model: 'gpt-5.4-mini', messages, max_tokens: 1024 }),
  });

  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const reply = json.choices[0]?.message.content ?? '(no response)';

  ctx.assistant(reply);
  console.log(`\nAssistant: ${reply}`);
  console.log(
    `  [tokens: ${snapshot.meta.totalTokens}, utilization: ${(snapshot.meta.utilization * 100).toFixed(1)}%]\n`,
  );
}

rl.close();
console.log('Goodbye!');
