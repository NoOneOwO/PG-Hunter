/**
 * PG Hunter — prerendered-page security headers.
 *
 * Astro middleware only runs for on-demand routes. Every prerendered page is
 * served straight out of the Workers static asset store, so the ONLY way to
 * attach a Content-Security-Policy to `/` is a `_headers` file in the built
 * client directory. The Cloudflare adapter writes one of those itself, but it
 * only carries the immutable Cache-Control rule for `/_astro/*`.
 *
 * This script rewrites that file so it also carries the full policy from
 * `src/lib/server/securityHeaders.ts`, which keeps the prerendered and
 * on-demand policies from drifting.
 *
 * The interesting part is the hashes. `script-src 'self'` alone is not enough:
 * Astro emits its `<astro-island>` runtime and per-page bootstrap as INLINE
 * <script> elements no matter what `assetsInlineLimit` is set to, and /profile/
 * is the only page that has them. A strict policy therefore refuses them and
 * hydration dies silently -- no error, just an island that never mounts. Rather
 * than weaken the policy to `'unsafe-inline'`, we hash the exact bytes the build
 * produced and allow precisely those.
 *
 * Hashing at build time is what keeps this from drifting. A hand-maintained
 * hash breaks the moment any inline script changes, which is a failure mode
 * that shows up as a silently dead island; deriving it here means the policy
 * and the output are always describing the same build by construction.
 *
 * Run via `npm run build` / `npm run deploy` (see package.json). Run with
 * Node's type stripping, like the test suite, so the policy can be imported
 * from the .ts source rather than duplicated here.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildContentSecurityPolicy,
  HSTS_HEADER,
  SECURITY_HEADERS,
} from '../src/lib/server/securityHeaders.ts';

const clientDir = fileURLToPath(new URL('../dist/client/', import.meta.url));
const headersPath = join(clientDir, '_headers');

if (!existsSync(clientDir)) {
  console.error(`[headers] ${clientDir} does not exist -- run astro build first.`);
  process.exit(1);
}

/** Pre-quoted CSP hash source for an exact inline block body. */
const hashSource = (body: string): string =>
  `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;

const collectHtmlFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectHtmlFiles(path));
    else if (entry.name.endsWith('.html')) found.push(path);
  }
  return found;
};

/**
 * Inline bodies only. `<script src=...>` and `<link rel=stylesheet>` are
 * ordinary same-origin files and need no hash.
 *
 * The body is hashed RAW, untrimmed: the browser hashes the exact text content
 * of the element, so trimming here would produce hashes that never match.
 */
const inlineBodies = (html: string, tag: 'script'): string[] => {
  const bodies: string[] = [];
  const pattern = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, 'gi');
  for (const match of html.matchAll(pattern)) {
    const attributes = match[1] ?? '';
    if (/\bsrc\s*=/.test(attributes)) continue;
    bodies.push(match[2] ?? '');
  }
  return bodies;
};

const scriptHashes = new Set<string>();
const pages = collectHtmlFiles(clientDir);

for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  for (const body of inlineBodies(html, 'script')) scriptHashes.add(hashSource(body));
}

// Scripts only. Inline <style> blocks are deliberately NOT hashed: the CSP
// spec ignores 'unsafe-inline' in a source list that also carries a hash, so
// adding one would re-break the runtime CSS Radix injects. See the note on
// style-src in src/lib/server/securityHeaders.ts.
const policy = buildContentSecurityPolicy({
  script: [...scriptHashes].sort(),
});

/**
 * Strip any header this script owns, so re-running is idempotent and a stale
 * policy can't linger alongside a fresh one. Rules the adapter owns
 * (e.g. the `/_astro/*` Cache-Control) are left completely alone.
 */
const ownedHeaders = new Set(
  [...Object.keys(SECURITY_HEADERS), 'Strict-Transport-Security'].map((name) => name.toLowerCase())
);

const previous = existsSync(headersPath) ? readFileSync(headersPath, 'utf8') : '';
const kept = previous
  .split('\n')
  .filter((line) => {
    const header = /^\s+([A-Za-z0-9-]+)\s*:/.exec(line);
    return !(header && ownedHeaders.has(header[1]!.toLowerCase()));
  })
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .trimEnd();

const securityBlock = [
  '/*',
  `  Content-Security-Policy: ${policy}`,
  ...Object.entries(SECURITY_HEADERS)
    .filter(([name]) => name !== 'Content-Security-Policy')
    .map(([name, value]) => `  ${name}: ${value}`),
  `  Strict-Transport-Security: ${HSTS_HEADER}`,
].join('\n');

writeFileSync(headersPath, `${kept ? `${kept}\n\n` : ''}${securityBlock}\n`, 'utf8');

console.log(
  `[headers] ${pages.length} pages, ${scriptHashes.size} inline script hash(es) -> _headers`,
);
