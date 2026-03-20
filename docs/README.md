# Documentation site (VitePress)

## Commands (from repo root)

| Script              | Description                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| `pnpm docs:dev`     | Local dev server                                                             |
| `pnpm docs:build`   | TypeDoc → `reference/api/`, then VitePress build (not part of `turbo build`) |
| `pnpm docs:preview` | Preview production build                                                     |
| `pnpm test:docs`    | `tsc --noEmit` on `docs/snippets`                                            |

## GitHub Pages

The [Docs workflow](../.github/workflows/docs.yml) sets `VITEPRESS_BASE` to `/<repository-name>/` for project pages. Enable **Pages** → **GitHub Actions** in the repository settings.

## Generated API

`docs/reference/api/` is produced by TypeDoc and is gitignored. Run `pnpm --filter @contextcraft/docs docs:api` before `vitepress dev` if you need API pages locally without a full build.
