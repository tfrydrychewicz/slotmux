/**
 * Angular chat example — standalone Node.js demonstration.
 *
 * This file shows the slotmux integration patterns for Angular:
 * - Injectable service wrapping ReactiveContext
 * - Signal-based reactivity with subscribe
 * - The same user flow as the React and Vue examples
 *
 * For a full Angular browser app, scaffold with `ng new` and copy the
 * service/component patterns from the src/ directory. See README.md.
 */

import type { SnapshotMeta } from 'slotmux';
import { reactiveContext } from 'slotmux/reactive';

// --- Simulates the Angular service (SlotmuxService) ---

class SlotmuxService {
  private readonly rctx = reactiveContext({
    model: 'gpt-5.4-mini',
    preset: 'chat',
    reserveForResponse: 4096,
    charTokenEstimateForMissing: true,
  });

  private metaValue: SnapshotMeta | null = null;
  private utilizationValue = 0;

  constructor() {
    this.rctx.system('You are a helpful assistant.');

    this.rctx.meta.subscribe(() => {
      this.metaValue = this.rctx.meta.value ?? null;
    });

    this.rctx.utilization.subscribe(() => {
      this.utilizationValue = this.rctx.utilization.value;
    });
  }

  get meta() {
    return this.metaValue;
  }

  get utilization() {
    return this.utilizationValue;
  }

  async sendMessage(text: string): Promise<string> {
    this.rctx.user(text);
    await this.rctx.build();

    const reply = `Echo: ${text}`;
    this.rctx.assistant(reply);
    await this.rctx.build();

    return reply;
  }
}

// --- Simulates the Angular component using the service ---

async function main() {
  const service = new SlotmuxService();

  console.log('Slotmux Angular Chat (Node.js simulation)\n');

  const conversations = [
    'Hello, how does slotmux work?',
    'What are overflow strategies?',
    'Can I use it with Angular?',
  ];

  for (const msg of conversations) {
    console.log(`User: ${msg}`);
    const reply = await service.sendMessage(msg);
    console.log(`Assistant: ${reply}`);

    const meta = service.meta;
    if (meta) {
      console.log(
        `  [tokens: ${meta.totalTokens}, utilization: ${(service.utilization * 100).toFixed(1)}%]`,
      );
    }
    console.log();
  }

  console.log('Done.');
}

main().catch(console.error);
