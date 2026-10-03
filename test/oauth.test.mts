/**
 * PG Hunter — Google OAuth error mapping tests.
 *
 * Google's `error` query param is echoed into a redirect URL by
 * /api/auth/google/callback, so the mapping has to be an allowlist. These tests
 * pin both the user-facing behaviour (a redirect_uri_mismatch is a config
 * problem, not a cancellation) and the safety property.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { googleErrorToCode } from '../src/lib/server/oauthErrors.ts';

test('a denied consent screen reads as a cancellation', () => {
  assert.equal(googleErrorToCode('access_denied'), 'google-denied');
});

test('redirect_uri_mismatch is reported distinctly, not as a cancellation', () => {
  // Regression guard: this used to collapse into 'google-denied', which told the
  // user they had cancelled a sign-in that Google had actually rejected.
  assert.equal(googleErrorToCode('redirect_uri_mismatch'), 'google-redirect-mismatch');
});

test('unknown and missing errors fall back to a generic failure', () => {
  assert.equal(googleErrorToCode('server_error'), 'google-failed');
  assert.equal(googleErrorToCode(null), 'google-failed');
  assert.equal(googleErrorToCode(''), 'google-failed');
});

test('untrusted error values are never reflected into the redirect code', () => {
  // The result is interpolated into `location: /login?error=<code>`, so it must
  // always be one of the known codes — never attacker-supplied text.
  const hostile = [
    'redirect_uri_mismatch/../../evil',
    'access_denied"><script>alert(1)</script>',
    'javascript:alert(1)',
    'redirect_uri_mismatch%20OR%201=1',
  ];
  const allowed = new Set(['google-denied', 'google-redirect-mismatch', 'google-failed']);
  for (const value of hostile) {
    const code = googleErrorToCode(value);
    assert.ok(allowed.has(code), `unexpected code for ${JSON.stringify(value)}: ${code}`);
  }
});
