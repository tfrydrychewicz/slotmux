# Getting started

For a **fully working terminal chatbot** with context metadata, token budgets, and OpenAI integration, see **[Terminal chatbot tutorial](/guide/build-a-chatbot)**.

## Install

```bash
pnpm add slotmux
```

Optional tokenizers (pick what your models need):

```bash
pnpm add gpt-tokenizer
```

## Minimal example

The snippet below is typechecked in CI (`pnpm test:docs`). Source: [`docs/snippets/quickstart.example.ts`](https://github.com/tfrydrychewicz/slotmux/tree/main/docs/snippets/quickstart.example.ts).

<<< @/snippets/quickstart.example.ts

## Packages

| Package           | Role                                      |
| ----------------- | ----------------------------------------- |
| `slotmux`    | Core context manager, slots, token budget |
| `@slotmux/*` | Compression, providers, React, debug UI   |

## Framework integration

For real-time UI that tracks context utilization, use `slotmux/reactive` with your framework:

- **[React](/guides/react)** — `@slotmux/react` hooks (`useReactiveContextMeta`, `useReactiveContextUtilization`, `useReactiveContextBuildError`).
- **[Vue](/guides/vue)** — `reactiveContext` refs work natively with `computed` / `watch` (no extra package needed).
- **[Angular](/guides/angular)** — bridge `reactiveContext` into an injectable service with Angular Signals or `async` pipe.

See the [design document](https://github.com/tfrydrychewicz/slotmux) in the repository for architecture notes (not shipped in this site).
