# Documentation site (VitePress)

## Commands (from repo root)

| Script              | Description                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| `pnpm docs:dev`     | Local dev server                                                             |
| `pnpm docs:build`   | TypeDoc → `reference/api/`, then VitePress build (not part of `turbo build`) |
| `pnpm docs:preview` | Preview production build                                                     |
| `pnpm test:docs`    | `tsc --noEmit` on `docs/snippets`                                            |

## GitHub Pages

The [Docs workflow](../.github/workflows/docs.yml) sets `VITEPRESS_BASE` to `/<repository-name>/` for project pages.

### One-time setup (required)

If **Deploy to GitHub Pages** fails with `HttpError: Not Found` / “Ensure GitHub Pages has been enabled”:

1. Repo **Settings** → **Pages**
2. **Build and deployment** → **Source**: choose **GitHub Actions** (not “Deploy from a branch”)
3. Save, then re-run the **Docs** workflow (or push to `main`)

Private repos need a plan that includes GitHub Pages for that visibility.

### URL

`https://<owner>.github.io/<repo>/` (e.g. `https://tfrydrychewicz.github.io/contextcraft/`)

## Generated API

`docs/reference/api/` is produced by TypeDoc and is gitignored. Run `pnpm --filter @contextcraft/docs docs:api` before `vitepress dev` if you need API pages locally without a full build.
