/**
 * PG Hunter — security header policy tests.
 *
 * These guard the two directives where a careless edit is a real regression
 * rather than a style disagreement:
 *
 *   1. `script-src` must never gain 'unsafe-inline'. Astro emits its
 *      <astro-island> runtime inline, so relaxing this looks like the easy fix
 *      for dead hydration; the correct answer is build-computed hashes
 *      (scripts/generate-static-headers.mts). Losing 'unsafe-inline' here is
 *      the single change that would undo the XSS defence in depth.
 *   2. `style-src` must keep fonts.googleapis.com. Dropping it makes every page
 *      silently fall back to the system font stack with no console error from
 *      our own code.
 *
 * Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildContentSecurityPolicy,
  CONTENT_SECURITY_POLICY,
  SECURITY_HEADERS,
} from '../src/lib/server/securityHeaders.ts';

const directive = (policy: string, name: string): string | undefined =>
  policy
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name} `) || part === name)
    .at(0);

test('script-src never allows inline script in production', () => {
  const scriptSrc = directive(CONTENT_SECURITY_POLICY, 'script-src') ?? '';
  assert.ok(scriptSrc.includes("'self'"), `expected 'self' in: ${scriptSrc}`);
  assert.ok(
    !scriptSrc.includes("'unsafe-inline'"),
    `script-src must not allow inline script: ${scriptSrc}`
  );
  assert.ok(!scriptSrc.includes("'unsafe-eval'"), `script-src must not allow eval: ${scriptSrc}`);
});

test('script-src-attr blocks inline event handlers', () => {
  assert.equal(directive(CONTENT_SECURITY_POLICY, 'script-src-attr'), "script-src-attr 'none'");
});

test('style-src keeps the Google Fonts stylesheet host', () => {
  const styleSrc = directive(CONTENT_SECURITY_POLICY, 'style-src') ?? '';
  assert.ok(
    styleSrc.includes('https://fonts.googleapis.com'),
    `dropping fonts.googleapis.com silently reverts the site to system fonts: ${styleSrc}`
  );
});

test('font-src allows the woff2 origin the stylesheet resolves to', () => {
  const fontSrc = directive(CONTENT_SECURITY_POLICY, 'font-src') ?? '';
  assert.ok(fontSrc.includes('https://fonts.gstatic.com'), fontSrc);
});

test('style-src allows inline CSS for Radix and the toast library', () => {
  // Both build CSS at runtime via styleSheet.cssText / appendChild(<style>),
  // which CSP blocks like any other inline style. Verified against the built
  // ProfileApp chunk; without this, dialogs lose their scroll lock.
  const styleSrc = directive(CONTENT_SECURITY_POLICY, 'style-src') ?? '';
  assert.ok(styleSrc.includes("'unsafe-inline'"), styleSrc);
});

test('buildContentSecurityPolicy appends script hashes without loosening the base', () => {
  const hashed = buildContentSecurityPolicy({
    script: ["'sha256-AAA='", "'sha256-BBB='"],
  });
  const scriptSrc = directive(hashed, 'script-src') ?? '';

  assert.ok(scriptSrc.includes("'sha256-AAA='") && scriptSrc.includes("'sha256-BBB='"), scriptSrc);
  assert.ok(scriptSrc.includes("'self'"), scriptSrc);
  assert.ok(!scriptSrc.includes("'unsafe-inline'"), scriptSrc);
  // Hashing must not add or drop directives.
  assert.equal(
    hashed.split(';').length,
    CONTENT_SECURITY_POLICY.split(';').length,
    'hashing must not add or drop directives'
  );
});

test('style-src carries no hash alongside unsafe-inline', () => {
  // The trap this guards: CSP ignores 'unsafe-inline' when the same source
  // list also contains a hash or nonce. Shipping the one inline <style> hash
  // next to 'unsafe-inline' therefore blocks the very runtime CSS that
  // 'unsafe-inline' was added to allow -- and the console names
  // 'unsafe-inline' as the culprit, which sends you looking in the wrong place.
  const styleSrc = directive(CONTENT_SECURITY_POLICY, 'style-src') ?? '';
  assert.ok(
    !/'sha256-|'nonce-/.test(styleSrc),
    `a hash in style-src silently disables 'unsafe-inline': ${styleSrc}`
  );
});

test('every emitted response header is non-empty', () => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    assert.ok(value.length > 0, `${name} must have a value`);
  }
  assert.ok('Strict-Transport-Security' in SECURITY_HEADERS === false, 'HSTS is set by the middleware');
});