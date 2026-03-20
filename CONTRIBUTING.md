# Contributing to slotmux

Thanks for your interest in contributing. This document covers coding standards, the PR process, and commit conventions.

## Development Setup

Use **Node.js ≥ 20.19** (see root `package.json` `engines`). Older versions (e.g. Node 18) cannot run the full monorepo build because `@slotmux/debug` uses Vite 8.

```bash
pnpm install
pnpm build
pnpm test
```

## Coding Standards

- **TypeScript**: Strict mode, no `any`. Follow the patterns in `slotmux-design.md`.
- **Tests**: Every new feature needs unit tests. Use `makeSlot`, `makeItem`, `makeContext` from `__tests__/helpers`.
- **Documentation**: JSDoc on all public APIs with `@param`, `@returns`, `@throws`, `@example`.
- **Linting**: Run `pnpm lint` before committing. Use `pnpm lint:fix` to auto-fix.

## PR Process

1. Create a branch from `main`.
2. Make your changes. Add a changeset if you're changing package behavior: `pnpm changeset`.
3. Ensure CI passes: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm size-limit`.
4. Open a PR. Fill out the template.
5. Address review feedback.
6. Squash and merge when approved.

## Commit Conventions

- Write clear, human-sounding commit messages.
- Avoid phase numbers or robotic prefixes (e.g. no "chore:", "feat:", "Phase 0.1").
- Be specific: "Add token count caching" not "Implement caching".

## Changesets

For changes that affect published packages:

```bash
pnpm changeset
```

Select the packages and version bump type. The changeset will be used when the "Version Packages" PR is merged.

## Questions?

Open an issue or discussion on GitHub.
