/**
 * Typechecked mirror of the terminal chatbot tutorial (no network I/O).
 * Validates that createContext → Context.fromParsedConfig → build → formatOpenAIMessages
 * compiles against the published types. Run via `pnpm test:docs` (after `pnpm build`).
 */
import { formatOpenAIMessages } from '@slotmux/providers';
import { createContext, Context } from 'slotmux';

export async function tutorialChatbotTypecheck(): Promise<void> {
  const { config } = createContext({
    model: 'gpt-4o-mini',
    preset: 'chat',
    reserveForResponse: 4096,
    lazyContentItemTokens: true,
  });

  const ctx = Context.fromParsedConfig(config);

  ctx.system('You are a helpful assistant. Answer concisely.');
  ctx.user('What is slotmux?');

  const { snapshot } = await ctx.build();

  const openaiMessages = formatOpenAIMessages(snapshot.messages);
  void openaiMessages;

  ctx.assistant('A TypeScript library for LLM context management.');
  ctx.user('How do I install it?');

  const { snapshot: snap2 } = await ctx.build();

  void snap2.meta.totalTokens;
  void snap2.meta.totalBudget;
  void snap2.meta.utilization;
  void snap2.meta.slots;
  void snap2.meta.warnings;
  void snap2.meta.buildTimeMs;
}

void tutorialChatbotTypecheck;
