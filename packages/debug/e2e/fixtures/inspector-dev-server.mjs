/**
 * Minimal Context + attachInspector for Playwright E2E.
 *
 * @packageDocumentation
 */

process.env['NODE_ENV'] = 'development';

const SLOTS = {
  system: {
    priority: 100,
    budget: { fixed: 80 },
    overflow: 'truncate',
    position: 'before',
  },
  history: {
    priority: 50,
    budget: { percent: 100 },
    overflow: 'truncate',
    position: 'after',
  },
};

const { Context, validateContextConfig } = await import('slotmux');
const { attachInspector } = await import('../../dist/index.js');

const parsed = validateContextConfig({
  model: 'm',
  maxTokens: 800,
  slots: SLOTS,
});
const ctx = Context.fromParsedConfig(parsed);
const handle = await attachInspector(ctx, {
  port: 4173,
  allowInNonDevelopment: true,
});

console.log(`Inspector UI + API at ${handle.url}`);

void (async () => {
  await new Promise((r) => setTimeout(r, 400));
  ctx.system('Playwright probe system');
  ctx.user('hello from e2e');
  await ctx.build();
})();
