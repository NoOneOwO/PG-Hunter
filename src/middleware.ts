/**
 * PG Hunter — request middleware.
 *
 * Runs for every on-demand route (/api/*, /admin/*, /owner/*, and any page
 * with `export const prerender = false`). Prerendered public pages are served
 * from the Workers static asset store and bypass the Worker entirely, so their
 * headers come from the `dist/_headers` file generated at build time from
 * `lib/server/securityHeaders.ts`.
 *
 * Responsibilities, in order:
 *   1. CSRF / cross-origin rejection for state-changing methods.
 *   2. Rate limiting, before any route work, so a flood never reaches a
 *      handler.
 *   3. Security response headers on everything that gets past the above.
 */

import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';

import { applySecurityHeaders } from './lib/server/securityHeaders';
import {
  consumeRateLimit,
  callerIdentifier,
  rateLimitResponse,
  sweepRateLimits,
} from './lib/server/rateLimit';
import { isCrossOriginRequest, isSafeMethod, rateLimitScopeFor } from './lib/server/requestPolicy';
import { SESSION_COOKIE, getDb, getUserFromSession } from './lib/server/auth';

export const onRequest = defineMiddleware(async (context, next) => {
  const { request } = context;
  const method = request.method.toUpperCase();
  const url = new URL(request.url);

  // --- 1. CSRF -----------------------------------------------------------
  if (!isSafeMethod(method) && isCrossOriginRequest(request, url.origin)) {
    return new Response(JSON.stringify({ error: 'Cross-origin request blocked.' }), {
      status: 403,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  // --- 2. Rate limiting --------------------------------------------------
  const scope = rateLimitScopeFor(url.pathname, method);
  if (scope) {
    const db = getDb();
    // One session lookup, reused for both identity and the counter. Failures
    // degrade to IP-based counting rather than skipping the limit.
    const user = await getUserFromSession(
      db,
      context.cookies.get(SESSION_COOKIE)?.value
    ).catch(() => null);

    const decision = await consumeRateLimit(db, scope, callerIdentifier(request, user?.id), {
      salt: env.RATE_LIMIT_SALT,
    });

    void sweepRateLimits(db);

    if (!decision.allowed) {
      return applySecurityHeaders(rateLimitResponse(decision, scope), request);
    }
  }

  // --- 3. Security headers ----------------------------------------------
  return applySecurityHeaders(await next(), request);
});
