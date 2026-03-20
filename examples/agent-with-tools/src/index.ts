import { formatOpenAIMessages } from '@slotmux/providers';
import { createContext, Context } from 'slotmux';

const OPENAI_KEY = process.env['OPENAI_API_KEY'];
if (!OPENAI_KEY) {
  console.error('Set OPENAI_API_KEY to run this example.');
  process.exit(1);
}

// --- Define tools ---
const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'get_weather',
      description: 'Get current weather for a city',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
        },
        required: ['city'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'calculate',
      description: 'Evaluate a math expression',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Math expression to evaluate' },
        },
        required: ['expression'],
      },
    },
  },
];

function executeGetWeather(city: string): string {
  const data: Record<string, string> = {
    london: '15°C, cloudy',
    tokyo: '22°C, sunny',
    'new york': '18°C, partly cloudy',
  };
  return data[city.toLowerCase()] ?? `Weather data not available for ${city}`;
}

function executeCalculate(expression: string): string {
  try {
    const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, '');
    const result = new Function(`return (${sanitized})`)() as number;
    return String(result);
  } catch {
    return `Error evaluating: ${expression}`;
  }
}

type ToolCall = {
  id: string;
  function: { name: string; arguments: string };
};

async function chatWithTools(
  messages: unknown[],
): Promise<{ content: string | null; toolCalls: ToolCall[] | undefined }> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.4-mini',
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 512,
    }),
  });

  const json = (await res.json()) as {
    choices: Array<{
      message: {
        content: string | null;
        tool_calls?: ToolCall[];
      };
    }>;
  };
  const msg = json.choices[0]?.message;
  return { content: msg?.content ?? null, toolCalls: msg?.tool_calls };
}

// --- Set up slotmux ---
const { config } = createContext({
  model: 'gpt-5.4-mini',
  preset: 'agent',
  reserveForResponse: 4096,
  lazyContentItemTokens: true,
});

const ctx = Context.fromParsedConfig(config);
ctx.system(
  'You are a helpful agent with access to weather and calculator tools. ' +
    'Use them when needed to answer user questions accurately.',
);

const question = "What's the weather in London and what is 47 * 23?";
console.log(`User: ${question}\n`);
ctx.user(question);

const MAX_ROUNDS = 5;
for (let round = 0; round < MAX_ROUNDS; round++) {
  const { snapshot } = await ctx.build();
  const messages = formatOpenAIMessages(snapshot.messages);

  const response = await chatWithTools(messages as unknown[]);

  if (!response.toolCalls || response.toolCalls.length === 0) {
    if (response.content) {
      ctx.assistant(response.content);
      console.log(`Assistant: ${response.content}`);
    }
    console.log(
      `\n[${round + 1} round(s), ${snapshot.meta.totalTokens} context tokens]`,
    );
    break;
  }

  // Record assistant's tool call request
  ctx.push('history', [
    {
      content: '',
      role: 'assistant',
      toolUses: response.toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      })),
    },
  ]);

  // Execute each tool and push results
  for (const tc of response.toolCalls) {
    const args = JSON.parse(tc.function.arguments) as Record<string, string>;
    let result: string;

    if (tc.function.name === 'get_weather') {
      result = executeGetWeather(args['city'] ?? '');
      console.log(`  [tool] get_weather(${args['city']}) → ${result}`);
    } else if (tc.function.name === 'calculate') {
      result = executeCalculate(args['expression'] ?? '');
      console.log(`  [tool] calculate(${args['expression']}) → ${result}`);
    } else {
      result = `Unknown tool: ${tc.function.name}`;
    }

    ctx.push('history', [
      {
        content: result,
        role: 'tool',
        toolCallId: tc.id,
      },
    ]);
  }
}
