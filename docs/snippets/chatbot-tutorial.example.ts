/**
 * Tutorial: build a chatbot-shaped context, format for OpenAI Chat Completions, read metadata.
 * Typechecked via `pnpm test:docs` (after `pnpm build`).
 */
import { contextBuilder } from 'contextcraft';
import { formatOpenAIMessages } from '@contextcraft/providers';

/** Build snapshot + OpenAI-shaped messages (no network I/O). */
export async function tutorialBuildChatbotContext(): Promise<void> {
  const { snapshot } = await contextBuilder()
    .model('gpt-4o-mini')
    .preset('chat')
    .reserve(4096)
    .system('You are a concise helper bot. Reply in one short paragraph.')
    .user('What is contextcraft in one sentence?')
    .assistant(
      'A TypeScript library that manages LLM context windows with slots, token budgets, and overflow strategies.',
    )
    .user('How do I install it?')
    .build();

  const openaiMessages = formatOpenAIMessages(snapshot.messages);
  void openaiMessages;

  const { meta } = snapshot;
  void meta.utilization;
  void meta.totalTokens;
  void meta.slots;
  void meta.warnings;
}

void tutorialBuildChatbotContext;
