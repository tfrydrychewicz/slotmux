# Getting started

For a **step-by-step chatbot walkthrough** (model, system prompt, turns, API shape, metadata), see **[Build a chatbot (~5 min)](/guide/build-a-chatbot)**.

## Install

```bash
pnpm add contextcraft
```

Optional tokenizers (pick what your models need):

```bash
pnpm add gpt-tokenizer
```

## Minimal example

The snippet below is typechecked in CI (`pnpm test:docs`). Source: [`docs/snippets/quickstart.example.ts`](https://github.com/tfrydrychewicz/contextcraft/tree/main/docs/snippets/quickstart.example.ts).

<<< @/snippets/quickstart.example.ts

## Packages

| Package           | Role                                      |
| ----------------- | ----------------------------------------- |
| `contextcraft`    | Core context manager, slots, token budget |
| `@contextcraft/*` | Compression, providers, React, debug UI   |

See the [design document](https://github.com/tfrydrychewicz/contextcraft) in the repository for architecture notes (not shipped in this site).
