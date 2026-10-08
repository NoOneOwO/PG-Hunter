/**
 * PG Hunter — request policy tests.
 *
 * `src/lib/server/requestPolicy.ts` is the pure decision layer that
 * `src/middleware.ts` applies to every on-demand route. It has no Cloudflare
 * imports on purpose, so it can be exercised under plain Node — but until now
 * nothing did, which meant the CSRF gate and the rate-limit routing were only
 * ever verified by hand.
 *
 * These tests pin the two decisions that are cheapest to get wrong:
 *
 *   1. CSRF: a state-changing request with no positive same-origin evidence is
 *      rejected. A missed header here is an actual security regression.
 *   2. Scope routing: auth routes must match their own budget (not the generic
 *      `api_write` one), and GET reads must not be rate limited at all.
 *
 * Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MUTATING_METHODS,
  isSafeMethod,
  isCrossOriginRequest,
  rateLimitScopeFor,
} from '../src/lib/server/requestPolicy.ts';

const ORIGIN = 'https://pghunter.in';

const req = (headers: Record<string, string> = {}): Request =>
  new Request(`${ORIGIN}/api/whatever`, { method: 'POST', headers });

/* ---------------------------------------------------------------- */
/* isSafeMethod                                                      */
/* ---------------------------------------------------------------- */

test('safe methods skip the CSRF check', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'get', 'head', 'options']) {
    assert.equal(isSafeMethod(method), true, `${method} should be safe`);
  }
});

test('state-changing methods never skip the CSRF check', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'delete']) {
    assert.equal(isSafeMethod(method), false, `${method} should be checked`);
  }
});

test('MUTATING_METHODS is exactly the set that requires CSRF', () => {
  assert.deepEqual([...MUTATING_METHODS].sort(), ['DELETE', 'PATCH', 'POST', 'PUT']);
  for (const method of MUTATING_METHODS) assert.equal(isSafeMethod(method), false);
});

/* ---------------------------------------------------------------- */
/* isCrossOriginRequest                                              */
/* ---------------------------------------------------------------- */

test('Sec-Fetch-Site: cross-site is rejected', () => {
  assert.equal(isCrossOriginRequest(req({ 'Sec-Fetch-Site': 'cross-site' }), ORIGIN), true);
});

test('Sec-Fetch-Site: none (address-bar navigation) is rejected', () => {
  assert.equal(isCrossOriginRequest(req({ 'Sec-Fetch-Site': 'none' }), ORIGIN), true);
});

test('Sec-Fetch-Site: same-origin with a matching Origin is allowed', () => {
  assert.equal(
    isCrossOriginRequest(req({ 'Sec-Fetch-Site': 'same-origin', Origin: ORIGIN }), ORIGIN),
    false
  );
});

test('Sec-Fetch-Site alone never grants access — positive evidence is required', () => {
  // Sec-Fetch-Site can only reject; allowing requires an Origin or Referer that
  // matches. A request with just `same-origin` and nothing else is still refused.
  assert.equal(isCrossOriginRequest(req({ 'Sec-Fetch-Site': 'same-origin' }), ORIGIN), true);
});

test('a matching Origin header is allowed', () => {
  assert.equal(isCrossOriginRequest(req({ Origin: ORIGIN }), ORIGIN), false);
});

test('a foreign Origin header is rejected', () => {
  assert.equal(isCrossOriginRequest(req({ Origin: 'https://evil.example' }), ORIGIN), true);
});

test('Origin wins over a spoofed same-origin Referer', () => {
  assert.equal(
    isCrossOriginRequest(req({ Origin: 'https://evil.example', Referer: `${ORIGIN}/x` }), ORIGIN),
    true
  );
});

test('with no Origin, a same-origin Referer is allowed', () => {
  assert.equal(isCrossOriginRequest(req({ Referer: `${ORIGIN}/owner/listings` }), ORIGIN), false);
});

test('with no Origin, a foreign Referer is rejected', () => {
  assert.equal(isCrossOriginRequest(req({ Referer: 'https://evil.example/x' }), ORIGIN), true);
});

test('with neither Origin nor Referer, the request is rejected', () => {
  assert.equal(isCrossOriginRequest(req(), ORIGIN), true);
});

test('a malformed Referer is rejected rather than crashing', () => {
  assert.equal(isCrossOriginRequest(req({ Referer: 'not a url' }), ORIGIN), true);
});

/* ---------------------------------------------------------------- */
/* rateLimitScopeFor                                                 */
/* ---------------------------------------------------------------- */

test('auth routes use their own budgets, matched by prefix', () => {
  assert.equal(rateLimitScopeFor('/api/auth/login', 'POST'), 'auth_login');
  assert.equal(rateLimitScopeFor('/api/auth/login/anything', 'POST'), 'auth_login');
  assert.equal(rateLimitScopeFor('/api/auth/register', 'POST'), 'auth_register');
  assert.equal(rateLimitScopeFor('/api/auth/google', 'GET'), 'auth_oauth_start');
  assert.equal(rateLimitScopeFor('/api/auth/google/callback', 'GET'), 'auth_oauth_start');
});

test('the Google OAuth callback is covered by the oauth budget', () => {
  // The whole dance shares one budget; if this drifts, the callback (a GET that
  // reaches a network call and a DB write) would be left unthrottled.
  assert.equal(rateLimitScopeFor('/api/auth/google/callback', 'GET'), 'auth_oauth_start');
});

test('feature routes map to their named scopes', () => {
  assert.equal(rateLimitScopeFor('/api/views', 'POST'), 'views');
  assert.equal(rateLimitScopeFor('/api/enquiries', 'POST'), 'enquiries');
  assert.equal(rateLimitScopeFor('/api/experiences', 'POST'), 'experiences');
  assert.equal(rateLimitScopeFor('/api/reports', 'POST'), 'reports');
  assert.equal(rateLimitScopeFor('/api/media', 'POST'), 'media_upload');
  assert.equal(rateLimitScopeFor('/api/media/some/key', 'GET'), 'media_upload');
});

test('chat splits by verb: sending is throttled as a write, polling as a read', () => {
  // A 3-second poll must not consume the send budget, and a send must not be
  // able to hide behind the looser polling allowance.
  assert.equal(rateLimitScopeFor('/api/chat', 'POST'), 'chat_send');
  assert.equal(rateLimitScopeFor('/api/chat/abc-123', 'POST'), 'chat_send');
  assert.equal(rateLimitScopeFor('/api/chat/abc-123/read', 'POST'), 'chat_send');
  assert.equal(rateLimitScopeFor('/api/chat', 'GET'), 'chat_read');
  assert.equal(rateLimitScopeFor('/api/chat/abc-123', 'GET'), 'chat_read');
  assert.notEqual(rateLimitScopeFor('/api/chat', 'POST'), 'chat_read');
});

test('unlisted mutating API routes fall back to api_write', () => {
  assert.equal(rateLimitScopeFor('/api/listings', 'POST'), 'api_write');
  assert.equal(rateLimitScopeFor('/api/owner/listings/abc', 'PUT'), 'api_write');
  assert.equal(rateLimitScopeFor('/api/saved', 'DELETE'), 'api_write');
});

test('GET reads of ordinary API routes are not rate limited', () => {
  assert.equal(rateLimitScopeFor('/api/listings', 'GET'), null);
  assert.equal(rateLimitScopeFor('/api/plans', 'GET'), null);
  assert.equal(rateLimitScopeFor('/api/health', 'GET'), null);
});

test('non-API paths are never rate limited here', () => {
  assert.equal(rateLimitScopeFor('/', 'GET'), null);
  assert.equal(rateLimitScopeFor('/owner/listings', 'POST'), null);
  assert.equal(rateLimitScopeFor('/pgs/some-pg', 'GET'), null);
  // The chat *pages* are not API routes; only their data endpoints are limited.
  assert.equal(rateLimitScopeFor('/messages', 'GET'), null);
  assert.equal(rateLimitScopeFor('/owner/messages', 'GET'), null);
});

test('named scopes take precedence over the generic api_write fallback', () => {
  // /api/media is mutating, but must resolve to media_upload, not api_write.
  assert.notEqual(rateLimitScopeFor('/api/media', 'POST'), 'api_write');
  assert.equal(rateLimitScopeFor('/api/media', 'POST'), 'media_upload');
});
