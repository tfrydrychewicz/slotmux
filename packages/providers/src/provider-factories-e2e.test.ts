/**
 * E2E tests for provider factory auto-wired summarization (§10.3).
 *
 * These tests use real API keys to verify that `slotmuxProvider` correctly
 * wires summarization into the overflow engine. When the history slot
 * overflows, the provider factory calls the real LLM API to compress content.
 *
 * Gated on environment variables — skipped unless API keys are set.
 *
 * @packageDocumentation
 */

import { Context, createContext } from 'slotmux';
import { describe, expect, it } from 'vitest';

import { anthropic } from './anthropic-provider.js';
import { formatOpenAIMessages } from './openai-adapter.js';
import { openai } from './openai-provider.js';

const OPENAI_KEY = process.env['OPENAI_API_KEY'];
const ANTHROPIC_KEY = process.env['ANTHROPIC_API_KEY'];

const HAS_OPENAI = typeof OPENAI_KEY === 'string' && OPENAI_KEY.length > 0;
const HAS_ANTHROPIC = typeof ANTHROPIC_KEY === 'string' && ANTHROPIC_KEY.length > 0;

// =========================================================================
// 1. OpenAI provider factory — auto-wired summarize on overflow
// =========================================================================

describe.skipIf(!HAS_OPENAI)(
  '@slow OpenAI provider factory E2E',
  { timeout: 120_000 },
  () => {
    it('auto-summarizes overflowing history via openai() factory', async () => {
      const provider = openai({ apiKey: OPENAI_KEY! });

      const { config } = createContext({
        model: 'gpt-4o-mini',
        preset: 'chat',
        maxTokens: 4000,
        reserveForResponse: 200,
        lazyContentItemTokens: true,
        slotmuxProvider: provider,
      });

      const ctx = Context.fromParsedConfig(config);
      ctx.system('You are a helpful assistant.');

      const turns = [
        { u: 'I want to plan a vacation to Japan. I want to visit Tokyo and Kyoto.', a: 'Great choices! Tokyo is a vibrant metropolis and Kyoto is famous for its temples and gardens. I recommend 3-4 days in Tokyo and 2-3 days in Kyoto.' },
        { u: 'What about transportation between the cities?', a: 'The Japan Rail Pass is your best option. It covers Shinkansen bullet trains. Tokyo to Kyoto takes about 2 hours 15 minutes.' },
        { u: 'What is the best time of year to visit Japan?', a: 'Cherry blossom season in late March to mid-April is stunning but crowded. Autumn offers beautiful foliage with fewer tourists.' },
        { u: 'Any hotel recommendations in Tokyo?', a: 'For first-timers, Shinjuku or Shibuya are great bases. Budget options include APA or Toyoko Inn. For luxury, try the Park Hyatt.' },
        { u: 'What about food recommendations in Kyoto?', a: 'Kyoto is known for kaiseki cuisine, matcha desserts, and yudofu (tofu hot pot). Visit Nishiki Market for street food and local specialties.' },
        { u: 'Should I get a pocket WiFi or a SIM card?', a: 'Both work well. Pocket WiFi devices can be rented at the airport and shared among travelers. SIM cards are simpler if you are traveling solo.' },
        { u: 'What cultural etiquette should I be aware of?', a: 'Remove shoes before entering homes and some restaurants. Bow when greeting people. Do not tip — it is considered rude. Be quiet on public transport.' },
        { u: 'Can you recommend any day trips from Tokyo?', a: 'Kamakura is great for the giant Buddha statue and hiking trails. Hakone offers hot springs with Mt. Fuji views. Nikko has ornate shrines in a mountain forest setting.' },
        { u: 'What about shopping districts in Tokyo?', a: 'Akihabara for electronics and anime, Harajuku for fashion and streetwear, Ginza for luxury brands, and Shimokitazawa for vintage clothing and independent boutiques.' },
        { u: 'Is it safe to travel alone in Japan?', a: 'Japan is one of the safest countries for solo travelers. Low crime rates, excellent public transportation, and helpful locals make it very welcoming. Learning basic Japanese phrases helps.' },
      ];

      for (const { u, a } of turns) {
        ctx.user(u);
        ctx.assistant(a);
      }

      const { snapshot } = await ctx.build();

      expect(snapshot.meta.totalTokens).toBeGreaterThan(0);
      expect(snapshot.meta.totalTokens).toBeLessThanOrEqual(snapshot.meta.totalBudget);

      const historyMeta = snapshot.meta.slots['history'];
      expect(historyMeta).toBeDefined();
      expect(historyMeta!.usedTokens).toBeLessThanOrEqual(historyMeta!.budgetTokens);

      expect(snapshot.messages.length).toBeGreaterThan(0);

      const messages = formatOpenAIMessages(snapshot.messages) as Array<{
        role: string;
        content: string;
      }>;
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]!.role).toBe('system');
    });

    it('works with a custom compressionModel', async () => {
      const provider = openai({
        apiKey: OPENAI_KEY!,
        compressionModel: 'gpt-4o-mini',
      });

      const { config } = createContext({
        model: 'gpt-4o-mini',
        preset: 'chat',
        maxTokens: 4000,
        reserveForResponse: 200,
        lazyContentItemTokens: true,
        slotmuxProvider: provider,
      });

      const ctx = Context.fromParsedConfig(config);
      ctx.system('You are a concise assistant.');

      for (let i = 0; i < 15; i++) {
        ctx.user(`Message ${i + 1}: Tell me about topic number ${i + 1} in detail. This is a long message to fill the context window and trigger overflow summarization.`);
        ctx.assistant(`Response ${i + 1}: Here is a detailed answer about topic ${i + 1}. It covers various aspects including history, current state, and future prospects of this particular subject matter.`);
      }

      const { snapshot } = await ctx.build();

      expect(snapshot.meta.totalTokens).toBeGreaterThan(0);
      expect(snapshot.meta.totalTokens).toBeLessThanOrEqual(snapshot.meta.totalBudget);
    });

    it('works with a custom summarize function', async () => {
      let customSummarizeCalled = false;

      const provider = openai({
        apiKey: OPENAI_KEY!,
        summarize: async (systemPrompt, userMessage) => {
          customSummarizeCalled = true;
          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${OPENAI_KEY}`,
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
              ],
              max_tokens: 256,
              temperature: 0,
            }),
          });
          const json = (await res.json()) as {
            choices: Array<{ message: { content: string } }>;
          };
          return json.choices[0]?.message.content ?? '';
        },
      });

      const { config } = createContext({
        model: 'gpt-4o-mini',
        maxTokens: 4000,
        reserveForResponse: 200,
        lazyContentItemTokens: true,
        slotmuxProvider: provider,
        slots: {
          system: {
            priority: 100,
            budget: { fixed: 200 },
            defaultRole: 'system',
            position: 'before' as const,
            overflow: 'error',
          },
          history: {
            priority: 50,
            budget: { fixed: 500 },
            defaultRole: 'user',
            position: 'after' as const,
            overflow: 'summarize',
          },
        },
      });

      const ctx = Context.fromParsedConfig(config);
      ctx.system('You are a helpful assistant.');

      for (let i = 0; i < 10; i++) {
        ctx.user(`User turn ${i + 1}: This is a detailed message about subject ${i + 1} that contains enough text to eventually cause the history slot to overflow beyond its 500 token budget.`);
        ctx.assistant(`Assistant turn ${i + 1}: Here is a comprehensive response covering multiple aspects of subject ${i + 1} with sufficient detail to contribute to overflow and trigger summarization.`);
      }

      const { snapshot } = await ctx.build();

      expect(snapshot.meta.totalTokens).toBeGreaterThan(0);
      expect(snapshot.meta.totalTokens).toBeLessThanOrEqual(snapshot.meta.totalBudget);
      expect(customSummarizeCalled).toBe(true);
    });

    it('builds correctly without overflow (short conversation)', async () => {
      const provider = openai({ apiKey: OPENAI_KEY! });

      const { config } = createContext({
        model: 'gpt-4o-mini',
        preset: 'chat',
        reserveForResponse: 4096,
        lazyContentItemTokens: true,
        slotmuxProvider: provider,
      });

      const ctx = Context.fromParsedConfig(config);
      ctx.system('You are a helpful assistant.');
      ctx.user('Hello!');

      const { snapshot } = await ctx.build();

      expect(snapshot.messages.length).toBe(2);
      expect(snapshot.meta.totalTokens).toBeGreaterThan(0);
      expect(snapshot.meta.utilization).toBeGreaterThan(0);
      expect(snapshot.meta.utilization).toBeLessThan(0.01);
    });
  },
);

// =========================================================================
// 2. Anthropic provider factory — auto-wired summarize on overflow
// =========================================================================

describe.skipIf(!HAS_ANTHROPIC)(
  '@slow Anthropic provider factory E2E',
  { timeout: 120_000 },
  () => {
    it('auto-summarizes overflowing history via anthropic() factory', async () => {
      const provider = anthropic({ apiKey: ANTHROPIC_KEY! });

      const { config } = createContext({
        model: 'claude-haiku-4-5-20251001',
        preset: 'chat',
        maxTokens: 4000,
        reserveForResponse: 200,
        charTokenEstimateForMissing: true,
        slotmuxProvider: provider,
      });

      const ctx = Context.fromParsedConfig(config);
      ctx.system('You are a helpful assistant.');

      const turns = [
        { u: 'Tell me about the history of computing.', a: 'Computing history spans from mechanical calculators in the 1600s to modern quantum computers. Key milestones include Babbage\'s Analytical Engine, Turing\'s theoretical work, ENIAC, and the microprocessor revolution.' },
        { u: 'What was the first programming language?', a: 'Fortran, developed by IBM in the 1950s, is widely considered the first high-level programming language. However, Plankalkül was designed earlier by Konrad Zuse in the 1940s.' },
        { u: 'How did the internet start?', a: 'ARPANET, funded by the US Department of Defense in the late 1960s, was the precursor to the internet. Tim Berners-Lee invented the World Wide Web in 1989 at CERN.' },
        { u: 'What about artificial intelligence?', a: 'AI research began in the 1950s with pioneers like Alan Turing and John McCarthy. It went through multiple "AI winters" before deep learning breakthroughs in the 2010s reignited interest.' },
        { u: 'Tell me about cloud computing.', a: 'Cloud computing emerged in the 2000s with AWS launching in 2006. It provides on-demand computing resources over the internet, replacing traditional on-premises infrastructure.' },
        { u: 'What is quantum computing?', a: 'Quantum computing uses quantum mechanical phenomena like superposition and entanglement to process information. It promises exponential speedups for certain problems like cryptography and optimization.' },
        { u: 'How has mobile computing evolved?', a: 'Mobile computing evolved from PDAs in the 1990s to smartphones with the iPhone in 2007. Today smartphones have more computing power than early supercomputers.' },
        { u: 'What are the latest trends in tech?', a: 'Current trends include generative AI, edge computing, 5G networks, extended reality, sustainable computing, and the convergence of IoT with AI for smart systems.' },
        { u: 'Tell me about blockchain technology.', a: 'Blockchain is a distributed ledger technology that enables secure, transparent, and tamper-proof record-keeping. Beyond cryptocurrencies, it is used in supply chain management, voting systems, and decentralized finance.' },
        { u: 'How has cybersecurity evolved?', a: 'Cybersecurity has evolved from basic antivirus software to sophisticated AI-driven threat detection, zero-trust architectures, and quantum-resistant encryption. The attack surface has expanded with IoT and cloud computing.' },
      ];

      for (const { u, a } of turns) {
        ctx.user(u);
        ctx.assistant(a);
      }

      const { snapshot } = await ctx.build();

      expect(snapshot.meta.totalTokens).toBeGreaterThan(0);
      expect(snapshot.meta.totalTokens).toBeLessThanOrEqual(snapshot.meta.totalBudget);

      const historyMeta = snapshot.meta.slots['history'];
      expect(historyMeta).toBeDefined();
      expect(historyMeta!.usedTokens).toBeLessThanOrEqual(historyMeta!.budgetTokens);
    });
  },
);

// =========================================================================
// 3. Provider factory with rag preset — verify summarize wiring works
// =========================================================================

describe.skipIf(!HAS_OPENAI)(
  '@slow Provider factory with RAG preset E2E',
  { timeout: 120_000 },
  () => {
    it('auto-summarizes overflowing rag history with openai() factory', async () => {
      const provider = openai({ apiKey: OPENAI_KEY! });

      const { config } = createContext({
        model: 'gpt-4o-mini',
        preset: 'rag',
        maxTokens: 4000,
        reserveForResponse: 200,
        lazyContentItemTokens: true,
        slotmuxProvider: provider,
      });

      const ctx = Context.fromParsedConfig(config);
      ctx.system('You are a knowledge assistant.');

      for (let i = 0; i < 5; i++) {
        ctx.push('rag', `Document ${i + 1}: This is a sample document with detailed information about topic ${i + 1}. It covers multiple aspects including background context, technical details, practical applications, and real-world use cases. The document spans several paragraphs to provide comprehensive coverage.`);
      }

      for (let i = 0; i < 12; i++) {
        ctx.user(`Question ${i + 1}: What can you tell me about topic ${i + 1}? Please provide a detailed answer covering all aspects mentioned in the relevant documents.`);
        ctx.assistant(`Answer ${i + 1}: Based on the documents provided, topic ${i + 1} covers several important aspects. The foundational concepts include theoretical frameworks and historical context. Practical applications range from everyday use to advanced implementations. The real-world impact has been significant across multiple domains.`);
      }

      const { snapshot } = await ctx.build();

      expect(snapshot.meta.totalTokens).toBeGreaterThan(0);
      expect(snapshot.meta.totalTokens).toBeLessThanOrEqual(snapshot.meta.totalBudget);
      expect(snapshot.messages.length).toBeGreaterThan(0);
    });
  },
);

// =========================================================================
// 4. Provider factory with agent preset — verify tool loop + summarize
// =========================================================================

describe.skipIf(!HAS_OPENAI)(
  '@slow Provider factory with agent preset E2E',
  { timeout: 120_000 },
  () => {
    it('handles agent preset overflow with openai() factory', async () => {
      const provider = openai({ apiKey: OPENAI_KEY! });

      const { config } = createContext({
        model: 'gpt-4o-mini',
        preset: 'agent',
        maxTokens: 4000,
        reserveForResponse: 200,
        lazyContentItemTokens: true,
        slotmuxProvider: provider,
      });

      const ctx = Context.fromParsedConfig(config);
      ctx.system('You are a helpful agent.');

      for (let i = 0; i < 12; i++) {
        ctx.user(`Request ${i + 1}: Please perform task number ${i + 1}. This requires careful analysis and a detailed response covering all relevant aspects.`);
        ctx.push('history', [
          {
            content: `Tool result for task ${i + 1}: The operation completed successfully. Output data includes status code 200, processing time 150ms, and detailed metrics for the requested operation.`,
            role: 'tool' as const,
            toolCallId: `call_${i}`,
          },
        ]);
        ctx.assistant(`I have completed task ${i + 1}. The results show that the operation was successful. All requirements were met and the output data confirms correct processing across all dimensions.`);
      }

      const { snapshot } = await ctx.build();

      expect(snapshot.meta.totalTokens).toBeGreaterThan(0);
      expect(snapshot.meta.totalTokens).toBeLessThanOrEqual(snapshot.meta.totalBudget);
    });
  },
);
