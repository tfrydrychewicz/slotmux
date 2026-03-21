import { formatOpenAIMessages, openai } from '@slotmux/providers';
import { NextResponse } from 'next/server';
import { createContext, Context } from 'slotmux';

export async function POST(request: Request) {
  const { messages } = (await request.json()) as {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  };

  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY not set' },
      { status: 500 },
    );
  }

  const { config } = createContext({
    model: 'gpt-5.4-mini',
    preset: 'chat',
    reserveForResponse: 4096,
    charTokenEstimateForMissing: true,
    slotmuxProvider: openai({ apiKey }),
  });

  const ctx = Context.fromParsedConfig(config);
  ctx.system('You are a helpful assistant. Keep answers concise and friendly.');

  for (const msg of messages) {
    if (msg.role === 'user') {
      ctx.user(msg.content);
    } else {
      ctx.assistant(msg.content);
    }
  }

  const { snapshot } = await ctx.build();
  const formatted = formatOpenAIMessages(snapshot.messages) as Array<{
    role: string;
    content: string;
  }>;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.4-mini',
      messages: formatted,
      max_tokens: 1024,
    }),
  });

  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const reply = json.choices[0]?.message.content ?? '(no response)';

  return NextResponse.json({
    reply,
    meta: {
      totalTokens: snapshot.meta.totalTokens,
      utilization: snapshot.meta.utilization,
    },
  });
}
