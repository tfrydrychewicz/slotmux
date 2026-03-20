/**
 * Phase 10.3 — Inspector server (§13.2).
 *
 * @packageDocumentation
 */

import { Context, validateContextConfig } from 'contextcraft';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type RawData, WebSocket } from 'ws';

import { attachInspector, InspectorDisabledError } from './index.js';

const SLOTS = {
  system: {
    priority: 100,
    budget: { fixed: 80 },
    overflow: 'truncate' as const,
    position: 'before' as const,
  },
  history: {
    priority: 50,
    budget: { percent: 100 },
    overflow: 'truncate' as const,
    position: 'after' as const,
  },
};

describe('attachInspector (Phase 10.3)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws InspectorDisabledError when NODE_ENV is not development and no override', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const parsed = validateContextConfig({
      model: 'm',
      maxTokens: 800,
      slots: SLOTS,
    });
    const ctx = Context.fromParsedConfig(parsed);
    await expect(attachInspector(ctx)).rejects.toThrow(InspectorDisabledError);
  });

  it('serves GET /health, /slots, /events and updates /snapshot after build', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const parsed = validateContextConfig({
      model: 'm',
      maxTokens: 800,
      slots: SLOTS,
    });
    const ctx = Context.fromParsedConfig(parsed);
    const handle = await attachInspector(ctx, { port: 0 });
    try {
      const base = handle.url;
      const health = await fetch(`${base}/health`);
      expect(health.ok).toBe(true);
      const h = (await health.json()) as { ok: boolean };
      expect(h.ok).toBe(true);

      const slotsRes = await fetch(`${base}/slots`);
      const slotsBody = (await slotsRes.json()) as { ok: boolean; slots?: unknown };
      expect(slotsBody.ok).toBe(true);
      expect(slotsBody.slots).toBeDefined();

      ctx.system('sys');
      ctx.user('hi');
      await ctx.build();

      const snapRes = await fetch(`${base}/snapshot`);
      const snapBody = (await snapRes.json()) as { ok: boolean; snapshot: unknown };
      expect(snapBody.ok).toBe(true);
      expect(snapBody.snapshot).not.toBeNull();

      const evRes = await fetch(`${base}/events`);
      const evBody = (await evRes.json()) as { ok: boolean; events: unknown[] };
      expect(evBody.ok).toBe(true);
      expect(evBody.events.length).toBeGreaterThan(0);
    } finally {
      await handle.close();
    }
  });

  it('broadcasts over WebSocket when events arrive', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const parsed = validateContextConfig({
      model: 'm',
      maxTokens: 800,
      slots: SLOTS,
    });
    const ctx = Context.fromParsedConfig(parsed);
    const handle = await attachInspector(ctx, { port: 0 });
    const wsUrl = handle.url.replace(/^http/, 'ws');

    const received: string[] = [];
    const ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });

    ws.on('message', (data: RawData) => {
      received.push(String(data));
    });

    try {
      ctx.system('s');
      await new Promise((r) => setTimeout(r, 50));
      expect(received.some((m) => m.includes('contextcraft:event'))).toBe(true);
    } finally {
      ws.close();
      await handle.close();
    }
  });
});
