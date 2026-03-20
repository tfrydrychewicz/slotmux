import { Pinecone } from '@pinecone-database/pinecone';
import { ragPlugin } from '@slotmux/plugin-rag';
import { formatOpenAIMessages } from '@slotmux/providers';
import { createContext, Context } from 'slotmux';

const OPENAI_KEY = process.env['OPENAI_API_KEY'];
const PINECONE_KEY = process.env['PINECONE_API_KEY'];

if (!OPENAI_KEY || !PINECONE_KEY) {
  console.error('Set OPENAI_API_KEY and PINECONE_API_KEY to run this example.');
  process.exit(1);
}

const INDEX_NAME = process.env['PINECONE_INDEX'] ?? 'slotmux-demo';

async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  });
  const json = (await res.json()) as {
    data: Array<{ embedding: number[] }>;
  };
  return json.data.map((d) => d.embedding);
}

async function chat(
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
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
  return json.choices[0]?.message.content ?? '(no response)';
}

// --- Set up Pinecone ---
const pc = new Pinecone({ apiKey: PINECONE_KEY });
const index = pc.index(INDEX_NAME);

// --- Set up slotmux with RAG plugin ---
const rag = ragPlugin({ maxChunks: 10, deduplication: true });

const { config } = createContext({
  model: 'gpt-5.4-mini',
  preset: 'rag',
  reserveForResponse: 4096,
  lazyContentItemTokens: true,
  plugins: [rag],
});

const ctx = Context.fromParsedConfig(config);
ctx.system(
  'You are a knowledge assistant. Answer questions using the provided documents. ' +
    'Cite document IDs when referencing specific information.',
);

// --- Query Pinecone and push results into the RAG slot ---
const query = 'What are the benefits of context window management?';
console.log(`Query: ${query}\n`);

const [queryVector] = await embed([query]);
const results = await index.query({
  vector: queryVector!,
  topK: 5,
  includeMetadata: true,
});

for (const match of results.matches) {
  const text = (match.metadata?.['text'] as string) ?? '';
  ctx.push('rag', [
    {
      content: text,
      role: 'user' as const,
      metadata: {
        'rag.chunkId': match.id,
        'rag.score': match.score ?? 0,
      },
    },
  ]);
}

console.log(`Loaded ${results.matches.length} chunks from Pinecone`);

ctx.user(query);

const { snapshot } = await ctx.build();
const messages = formatOpenAIMessages(snapshot.messages) as Array<{
  role: string;
  content: string;
}>;

console.log(`\nContext: ${snapshot.meta.totalTokens} tokens, ${(snapshot.meta.utilization * 100).toFixed(1)}% utilization`);

for (const [name, slot] of Object.entries(snapshot.meta.slots)) {
  console.log(`  ${name}: ${slot.usedTokens} tokens (${slot.itemCount} items)`);
}

const answer = await chat(messages);
console.log(`\nAnswer: ${answer}`);
