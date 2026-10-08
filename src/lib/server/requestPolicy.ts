/**
 * PG Hunter — pure request policy.
 *
 * Deliberately free of any `cloudflare:workers` / `env` import so the logic
 * can be unit tested under plain Node. src/middleware.ts is the thin layer that
 * wires these decisions to the D1 binding and the response.
 */

import type { RateLimitScope } from './rateLimit';

export const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Safe (non-state-changing) methods, which skip the CSRF check. */
export const isSafeMethod = (method: string): boolean => {
  const upper = method.toUpperCase();
  return upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS';
};


/**
 * CSRF / cross-origin decision for a state-changing request.
 *
 * Three independent signals, any one of which is enough to reject:
 *   - `Sec-Fetch-Site: cross-site` (all modern browsers send this)
 *   - `Origin` must equal the request's own origin
 *   - `Referer`'s origin must equal it when `Origin` is absent
 *
 * A request carrying neither `Origin` nor `Referer` is rejected. This is a
 * browser-only API surface, so a legitimate caller always sends at least one:
 * a same-origin fetch/XHR sends `Origin`, a form navigation sends `Referer`.
 * `Sec-Fetch-Site: none` covers a user-initiated address-bar navigation, which
 * is never a legitimate way to reach these endpoints.
 *
 * Only applies to POST/PUT/PATCH/DELETE. The Google OAuth callback is a GET,
 * which is why that flow is unaffected.
 */
export const isCrossOriginRequest = (request: Request, origin: string): boolean => {
  const secFetchSite = request.headers.get('Sec-Fetch-Site');
  if (secFetchSite === 'cross-site' || secFetchSite === 'none') return true;

  const originHeader = request.headers.get('Origin');
  if (originHeader) return originHeader !== origin;

  const referer = request.headers.get('Referer');
  if (!referer) return true;

  try {
    return new URL(referer).origin !== origin;
  } catch {
    return true;
  }
};

/**
 * Map a pathname + method onto a rate-limit policy, or null when the route is
 * not rate limited.
 *
 * `POST /api/auth/login` and friends are matched by prefix so that the
 * sub-paths of the OAuth dance (start, callback, disconnect) share one budget.
 */
export const rateLimitScopeFor = (pathname: string, method: string): RateLimitScope | null => {
  if (pathname.startsWith('/api/auth/login')) return 'auth_login';
  if (pathname.startsWith('/api/auth/register')) return 'auth_register';
  if (pathname.startsWith('/api/auth/google')) return 'auth_oauth_start';
  if (pathname.startsWith('/api/views')) return 'views';
  if (pathname.startsWith('/api/enquiries')) return 'enquiries';
  if (pathname.startsWith('/api/experiences')) return 'experiences';
  if (pathname.startsWith('/api/reports')) return 'reports';
  if (pathname.startsWith('/api/media')) return 'media_upload';

  // Chat splits by verb: sending is limited like other writes, while polling a
  // thread is a read and gets its own, much looser budget — a 3-second poll
  // would otherwise exhaust the write allowance within a minute.
  if (pathname.startsWith('/api/chat')) {
    return MUTATING_METHODS.has(method.toUpperCase()) ? 'chat_send' : 'chat_read';
  }

  if (pathname.startsWith('/api/') && MUTATING_METHODS.has(method.toUpperCase())) {
    return 'api_write';
  }
  return null;
};
