/**
 * tools plugin integration.
 *
 * @packageDocumentation
 */

import { Context, createContext, toTokenCount } from 'slotmux';
import { describe, expect, it } from 'vitest';

import {
  TOOLS_KIND_DEFINITION,
  TOOLS_METADATA_KIND,
  toolsPlugin,
} from './tools-plugin.js';

describe('toolsPlugin integration', () => {
  it('prepareSlots adds tools slot on chat preset', () => {
    const plugin = toolsPlugin();
    const { config } = createContext({
      model: 'gpt-4o-mini',
      strictTokenizerPeers: false,
      preset: 'chat',
      plugins: [plugin],
    });
    expect(config.slots?.['tools']).toBeDefined();
  });

  it('caps tool-role results to maxToolResults', async () => {
    const plugin = toolsPlugin({ maxToolResults: 5 });
    const { config } = createContext({
      model: 'gpt-4o-mini',
      maxTokens: 8000,
      strictTokenizerPeers: false,
      preset: 'chat',
      plugins: [plugin],
    });
    const ctx = Context.fromParsedConfig(config);
    for (let i = 0; i < 12; i++) {
      ctx.push('tools', [
        {
          role: 'tool',
          content: `output-${i}`,
          tokens: toTokenCount(8),
          toolCallId: `call-${i}`,
        },
      ]);
    }
    const { snapshot } = await ctx.build();
    const toolMsgs = snapshot.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs.length).toBe(5);
  });

  it('truncates large tool results when enabled', async () => {
    const plugin = toolsPlugin({
      truncateLargeResults: true,
      resultMaxTokens: 80,
      maxToolResults: 20,
    });
    const { config } = createContext({
      model: 'gpt-4o-mini',
      maxTokens: 8000,
      strictTokenizerPeers: false,
      preset: 'chat',
      plugins: [plugin],
    });
    const ctx = Context.fromParsedConfig(config);
    const big = 'word '.repeat(2000);
    ctx.push('tools', [
      {
        role: 'tool',
        content: big,
        tokens: toTokenCount(2000),
        toolCallId: 'c1',
      },
    ]);
    const { snapshot } = await ctx.build();
    const tool = snapshot.messages.find((m) => m.role === 'tool');
    expect(typeof tool?.content).toBe('string');
    expect((tool?.content as string).length).toBeLessThan(big.length);
    expect(tool?.content).toContain('[truncated]');
  });

  it('assigns token estimates for definition rows', async () => {
    const plugin = toolsPlugin({ maxToolResults: 10 });
    const { config } = createContext({
      model: 'gpt-4o-mini',
      maxTokens: 8000,
      strictTokenizerPeers: false,
      preset: 'chat',
      plugins: [plugin],
    });
    const ctx = Context.fromParsedConfig(config);
    const schema = JSON.stringify({
      name: 'get_weather',
      parameters: { type: 'object', properties: { city: { type: 'string' } } },
    });
    ctx.push('tools', [
      {
        role: 'user',
        content: schema,
        metadata: { [TOOLS_METADATA_KIND]: TOOLS_KIND_DEFINITION },
      },
    ]);
    const { snapshot } = await ctx.build();
    expect(snapshot.messages.length).toBeGreaterThan(0);
    const text = JSON.stringify(snapshot.messages);
    expect(text).toContain('get_weather');
  });
});
