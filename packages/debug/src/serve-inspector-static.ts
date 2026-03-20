/**
 * Serves the Vite-built Preact inspector under `/inspector/*`.
 *
 * @packageDocumentation
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Built UI lives next to `dist/` (see `ui/vite.config.mts`). */
const STATIC_ROOT = fileURLToPath(new URL('../inspector-static', import.meta.url));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function safeResolvedPath(root: string, relativePath: string): string | null {
  const resolved = resolve(root, relativePath);
  const rel = relative(root, resolved);
  if (rel.startsWith('..') || rel.startsWith('/')) {
    return null;
  }
  return resolved;
}

function send503(res: ServerResponse, message: string): void {
  const body = JSON.stringify({
    ok: false,
    error: message,
  });
  res.writeHead(503, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

/**
 * @returns `true` if the request was handled (including 404/503 for `/inspector/*`).
 */
export function serveInspectorStatic(pathname: string, res: ServerResponse): boolean {
  const prefix = '/inspector';
  if (!pathname.startsWith(prefix)) {
    return false;
  }

  let rel = pathname.slice(prefix.length).replace(/^\//, '');
  if (rel === '' || rel.endsWith('/')) {
    rel = 'index.html';
  }

  let filePath = safeResolvedPath(STATIC_ROOT, rel);
  if (filePath === null) {
    res.writeHead(400).end();
    return true;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    const fallback = safeResolvedPath(STATIC_ROOT, 'index.html');
    if (fallback === null || !existsSync(fallback)) {
      send503(
        res,
        'Inspector UI not built. Run: pnpm --filter @slotmux/debug run build:ui',
      );
      return true;
    }
    filePath = fallback;
  }

  const ext = extname(filePath).toLowerCase();
  const type = MIME[ext] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  createReadStream(filePath).pipe(res);
  return true;
}
