/**
 * PG Hunter — security response headers.
 *
 * Single source of truth. Consumed by:
 *   - src/middleware.ts          -> on-demand routes (/api/*, /admin/*, /owner/*)
 *   - astro.config.mjs           -> writes dist/_headers for prerendered pages
 *
 * Astro middleware only runs for on-demand routes, so prerendered pages are
 * served straight from the Workers static asset store and never pass through
 * the Worker. `dist/_headers` is the only way to attach headers to those, and
 * generating it from this module keeps the two policies from drifting.
 *
 * CSP is strict: no `unsafe-inline` and no `unsafe-eval` for scripts. Astro
 * inlines small script chunks by default (Vite's `assetsInlineLimit`), which
 * would force `unsafe-inline` on every page -- `astro.config.mjs` pins that
 * limit to 0 so every script is an external file under 'self'.
 */

const isDev = import.meta.env?.DEV === true;

/**
 * Directive values that differ in dev.
 *
 * These must REPLACE their production counterparts rather than be appended as a
 * second copy of the same directive: CSP ignores every directive after the first
 * occurrence of a given name, so a trailing `style-src 'self' 'unsafe-inline'`
 * never relaxes anything and the whole dev server renders unstyled (Vite injects
 * styles as inline <style> tags).
 */
// fonts.googleapis.com serves the @font-face CSS for Plus Jakarta Sans, so it
// has to be in style-src or the <link> in BaseLayout is refused and the whole
// site silently falls back to the system stack. font-src below allows the
// actual woff2 files on fonts.gstatic.com.
const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com';
const STYLE_SRC = isDev
  ? `'self' 'unsafe-inline' ${GOOGLE_FONTS_CSS}`
  : `'self' ${GOOGLE_FONTS_CSS}`;
const CONNECT_SRC = isDev
  ? "'self' ws: wss: http://localhost:* http://127.0.0.1:*"
  : "'self'";

// Dev also has to relax script-src. Astro always emits its <astro-island>
// runtime and its per-page bootstrap as INLINE <script> elements -- it does not
// route them through Vite's assetsInlineLimit -- and Vite's own dev client is
// injected inline as well. Under `script-src 'self'` every one of those is
// refused, so hydrated React islands (see src/components/ui/*) silently never
// hydrate on localhost.
//
// Production is unaffected: prerendered pages are served straight from the
// Workers asset store without invoking the Worker, so this header never reaches
// them. If `dist/_headers` is ever generated as this file's header claims, any
// CSP it writes MUST allow Astro's inline island runtime -- either
// `'unsafe-inline'` or the two SHA-256 hashes of the emitted script bodies --
// or islands will break in production exactly the way they did in dev.
const SCRIPT_SRC = isDev ? "'self' 'unsafe-inline'" : "'self'";

/**
 * Content-Security-Policy.
 *
 * - `script-src 'self'` is the load-bearing directive here; it is what turns
 *   the XSS fixes from best-effort into defence in depth.
 * - `style-src-attr 'unsafe-inline'` covers the handful of inline
 *   `style="width: N%"` progress-bar attributes. A style attribute cannot
 *   execute script, and it is deliberately scoped to attributes only so
 *   `<style>` blocks still have to come from 'self' (except in dev, where
 *   Vite has to inject them).
 * - `frame-src` is the YouTube embed host; `img-src` the YouTube thumbnail
 *   and Unsplash placeholder hosts.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src ${SCRIPT_SRC}`,
  "script-src-attr 'none'",
  `style-src ${STYLE_SRC}`,
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob: https://images.unsplash.com https://i.ytimg.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "media-src 'self' blob:",
  `connect-src ${CONNECT_SRC}`,
  'frame-src https://www.youtube-nocookie.com https://www.youtube.com',
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join('; ');

/**
 * Base header set applied to every response the Worker produces, plus to
 * prerendered pages via the generated `_headers` file.
 *
 * HSTS is omitted here and added conditionally in the middleware, because the
 * generated static file cannot know whether the request arrived over https.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'geolocation=(self), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  // The legacy XSS auditor is worse than useless and has false positives;
  // the modern control is CSP above.
  'X-XSS-Protection': '0',
};

export const HSTS_HEADER = 'max-age=31536000; includeSubDomains';

/**
 * Apply the security headers to a response.
 *
 * Headers are only added when absent, so a route that deliberately sets its
 * own `Cache-Control` or CSP keeps it.
 */
export const applySecurityHeaders = (response: Response, request: Request): Response => {
  // A Response created by `next()` may have immutable headers (e.g. a
  // redirect), in which case we fall back to a mutable copy.
  let target: Response;
  try {
    target = new Response(response.body, response);
    target.headers.set('__probe__', '1');
    target.headers.delete('__probe__');
  } catch {
    target = response;
  }

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!target.headers.has(name)) target.headers.set(name, value);
  }

  const isHttps =
    new URL(request.url).protocol === 'https:' ||
    request.headers.get('X-Forwarded-Proto') === 'https';
  if (isHttps && !target.headers.has('Strict-Transport-Security')) {
    target.headers.set('Strict-Transport-Security', HSTS_HEADER);
  }

  return target;
};
