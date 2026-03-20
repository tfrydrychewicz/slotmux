/**
 * Debug inspector E2E test (§17.1) — verifies the inspector starts and serves
 * all endpoints without environment stubs.
 *
 * @packageDocumentation
 */

import { Context, createContext } from 'slotmux';
import { afterEach, describe, expect, it } from 'vitest';

import { attachInspector, type InspectorHandle } from './index.js';

describe('@slow Debug inspector E2E', { timeout: 15_000 }, () => {
  let handle: InspectorHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = undefined;
    }
  });

  it('starts the inspector server and serves health, slots, snapshot, events, and UI', async () => {
    const { config } = createContext({
      model: 'gpt-4o-mini',
      preset: 'chat',
      maxTokens: 128_000,
      charTokenEstimateForMissing: true,
    });
    const ctx = Context.fromParsedConfig(config);
    ctx.system('Test system prompt for inspector E2E');
    ctx.user('Test user message for inspector E2E');

    handle = await attachInspector(ctx, {
      port: 0,
      allowInNonDevelopment: true,
    });

    expect(handle.port).toBeGreaterThan(0);
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const healthRes = await fetch(`${handle.url}/health`);
    expect(healthRes.ok).toBe(true);
    const healthJson = (await healthRes.json()) as { ok: boolean; package: string; endpoints: string[] };
    expect(healthJson.ok).toBe(true);
    expect(healthJson.package).toBe('@slotmux/debug');
    expect(healthJson.endpoints).toContain('/snapshot');
    expect(healthJson.endpoints).toContain('/slots');
    expect(healthJson.endpoints).toContain('/events');

    const slotsRes = await fetch(`${handle.url}/slots`);
    expect(slotsRes.ok).toBe(true);
    const slotsJson = (await slotsRes.json()) as { ok: boolean; slots: Record<string, unknown> };
    expect(slotsJson.ok).toBe(true);
    expect(Object.keys(slotsJson.slots)).toContain('system');
    expect(Object.keys(slotsJson.slots)).toContain('history');

    await ctx.build();

    const snapshotRes = await fetch(`${handle.url}/snapshot`);
    expect(snapshotRes.ok).toBe(true);
    const snapshotJson = (await snapshotRes.json()) as { ok: boolean; snapshot: unknown };
    expect(snapshotJson.ok).toBe(true);
    expect(snapshotJson.snapshot).not.toBeNull();

    const eventsRes = await fetch(`${handle.url}/events`);
    expect(eventsRes.ok).toBe(true);
    const eventsJson = (await eventsRes.json()) as { ok: boolean; events: unknown[] };
    expect(eventsJson.ok).toBe(true);
    expect(eventsJson.events.length).toBeGreaterThan(0);

    const uiRes = await fetch(`${handle.url}/inspector/`);
    expect(uiRes.ok).toBe(true);
    const html = await uiRes.text();
    expect(html).toContain('Slotmux Inspector');

    const notFoundRes = await fetch(`${handle.url}/nonexistent`);
    expect(notFoundRes.status).toBe(404);
  });
});
