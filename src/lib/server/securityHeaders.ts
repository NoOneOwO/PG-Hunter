/**
 * PG Hunter — security response headers.
 *
 * Single source of truth. Consumed by:
 *   - src/middleware.ts                     -> on-demand routes (/api/*, /admin/*, /owner/*)
 *   - scripts/generate-static-headers.mts   -> writes dist/client/_headers for prerendered pages
 *
 * Astro middleware only runs for on-demand routes, so prerendered pages are
 * served straight from the Workers static asset store and never pass through
 * the Worker. `dist/client/_headers` is the only way to attach headers to
 * those, and generating it from this module keeps the two policies from
 * drifting. The generator also injects per-build SHA-256 hashes of the inline
 * script/style bodies, which is what lets `script-src` stay free of
 * 'unsafe-inline' -- see SCRIPT_SRC.
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

// 'unsafe-inline' is load-bearing in production, not sloppiness. Radix (via
// react-remove-scroll) and the toast library both build their CSS at runtime by
// assigning styleSheet.cssText or appendChild(<style>), and CSP blocks that
// exactly as it blocks a static <style>. Verified against the built ProfileApp
// chunk: without this the console fills with "Refused to apply inline style" and
// dialogs lose their scroll lock. No build-time hash can cover it, because the
// CSS does not exist until React mounts.
//
// This relaxes CSS only. `script-src` below stays hash-strict with no
// 'unsafe-inline', and that is the directive that actually stops XSS.
const STYLE_SRC = `'self' 'unsafe-inline' ${GOOGLE_FONTS_CSS}`;
const CONNECT_SRC = isDev
  ? "'self' ws: wss: http://localhost:* http://127.0.0.1:*"
  : "'self'";

// Dev also has to relax script-src. Vite's own dev client is injected inline,
// so under `script-src 'self'` hydrated React islands (see src/components/ui/*)
// never hydrate on localhost.
//
// Production cannot use 'unsafe-inline' for the same reason it cannot omit
// hashes: Astro emits its <astro-island> runtime and per-page bootstrap as
// INLINE <script> elements regardless of assetsInlineLimit, and /profile/ is
// the only page that has them. scripts/generate-static-headers.mts therefore
// hashes every inline body out of the built HTML and feeds the results back
// through buildContentSecurityPolicy(). On-demand routes have no such pass, so
// they get the un-hashed policy -- acceptable only because they render no
// islands. If an on-demand page ever gains one, give it hashes the same way.
// Cloudflare injects its Web Analytics beacon at the edge, so it only ever
// shows up in production -- never in `astro preview`. Under a strict
// `script-src 'self'` it is refused, which silently stops analytics rather
// than erroring anywhere visible. Declared before SCRIPT_SRC uses it.
const CLOUDFLARE_RUM_SRC = 'https://static.cloudflareinsights.com';

// Google account pictures are stored as absolute CDN URLs on `users.avatar_url`
// (see the OAuth callback) and rendered directly by the profile header and the
// nav pill. Without these hosts in img-src the browser refuses the image and the
// user sees a broken-image icon after signing in with Google. Google serves the
// same picture from several regional hosts, hence the range.
const GOOGLE_AVATAR_HOSTS = [
  'https://lh3.googleusercontent.com',
  'https://lh4.googleusercontent.com',
  'https://lh5.googleusercontent.com',
  'https://lh6.googleusercontent.com',
].join(' ');

const SCRIPT_SRC = isDev ? "'self' 'unsafe-inline'" : `'self' ${CLOUDFLARE_RUM_SRC}`;

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
export interface ContentSecurityPolicyHashes {
  /**
   * Pre-quoted `'sha256-...'` sources covering every inline <script> body in
   * the built HTML. Astro emits its `<astro-island>` runtime inline, so a bare
   * `script-src 'self'` silently kills hydration -- see the note on SCRIPT_SRC.
   */
  script?: string[];
}

export const buildContentSecurityPolicy = (hashes: ContentSecurityPolicyHashes = {}): string => {
  const scriptSrc = [SCRIPT_SRC, ...(hashes.script ?? [])].join(' ');

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSrc}`,
    "script-src-attr 'none'",
    // No hashes here on purpose. Per CSP, a source list containing a hash or
    // nonce ignores 'unsafe-inline' entirely -- so appending the one inline
    // <style> hash alongside 'unsafe-inline' makes the styles get refused
    // again, with the console blaming 'unsafe-inline' right next to it. The
    // hash could never cover Radix's runtime CSS anyway, since that CSS does
    // not exist until React mounts.
    `style-src ${STYLE_SRC}`,
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' data: blob: ${GOOGLE_AVATAR_HOSTS} https://images.unsplash.com https://i.ytimg.com`,
    "font-src 'self' data: https://fonts.gstatic.com",
    "media-src 'self' blob:",
    `connect-src ${CONNECT_SRC}`,
    'frame-src https://www.youtube-nocookie.com https://www.youtube.com',
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join('; ');
};

export const CONTENT_SECURITY_POLICY = buildContentSecurityPolicy();

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
