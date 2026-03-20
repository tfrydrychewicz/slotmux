# Security

## Reporting

Please report security issues responsibly (avoid public issues for undisclosed vulnerabilities). Use the repository’s security policy or maintainer contact if available.

## Supply chain — `slotmux` core (Phase 13.2 / §19.1)

### Runtime dependencies (audited allowlist)

The published **`slotmux`** package (`packages/core`) intentionally keeps a **small, reviewed** set of **runtime** `dependencies`:

| Package                     | Role                                    |
|----------------------------|-----------------------------------------|
| `@slotmux/compression` | Workspace-linked compression strategies |
| `nanoid`                   | Content item IDs                        |
| `zod`                      | Config validation                       |

**Tokenizers** are **peer dependencies** (optional / user-installed), not bundled — see `package.json` `peerDependencies`.

CI runs `node scripts/verify-core-runtime-deps.mjs` to ensure `dependencies` does not grow without an explicit allowlist update.

> The original design goal of *zero* npm runtime deps is not met today; the **audit** is enforced via the allowlist script and this document.

### CI

- **`pnpm audit --audit-level=high`** runs on every PR / push to `main` (moderate/low advisories do not fail the build; tighten policy as needed).
- Root **`pnpm.overrides.esbuild`** (`>=0.25.0`) lifts Vitest/Vite’s transitive `esbuild` past [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) until those tools default to a patched release.
- **Dependabot** opens weekly PRs for npm and GitHub Actions (see `.github/dependabot.yml`).

### Releases

Published packages from GitHub Actions use **npm provenance** when `NPM_CONFIG_PROVENANCE=true` and `id-token: write` are set (see `.github/workflows/release.yml`).
