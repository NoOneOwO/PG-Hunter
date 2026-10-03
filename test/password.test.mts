/**
 * PG Hunter — password hashing tests.
 *
 * The first test is the important one: production signup and password login
 * both returned an empty HTTP 500 because the code asked workerd for 210,000
 * PBKDF2 iterations and the runtime refuses anything above 100,000. Node has no
 * such limit, so nothing here would have caught it except an explicit bound.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PBKDF2_ITERATIONS,
  WORKERD_MAX_PBKDF2_ITERATIONS,
  hashPassword,
  verifyPassword,
  parseStoredHash,
  timingSafeEqual,
} from '../src/lib/server/password.ts';

test('PBKDF2 iterations stay within the workerd ceiling', () => {
  // Regression guard: exceeding this throws NotSupportedError inside the
  // Workers runtime, which surfaces to users as an opaque 500 on signup/login.
  assert.ok(
    PBKDF2_ITERATIONS <= WORKERD_MAX_PBKDF2_ITERATIONS,
    `PBKDF2_ITERATIONS (${PBKDF2_ITERATIONS}) exceeds the workerd maximum ` +
      `(${WORKERD_MAX_PBKDF2_ITERATIONS}); password hashing would throw in production`
  );
});

test('a hash verifies against its own password', async () => {
  const salt = 'a'.repeat(32);
  const stored = await hashPassword('correct horse battery staple', salt);
  assert.equal(await verifyPassword('correct horse battery staple', salt, stored), true);
});

test('a hash rejects the wrong password', async () => {
  const salt = 'b'.repeat(32);
  const stored = await hashPassword('correct horse battery staple', salt);
  assert.equal(await verifyPassword('wrong password', salt, stored), false);
  assert.equal(await verifyPassword('', salt, stored), false);
});

test('the stored format records its parameters', async () => {
  const stored = await hashPassword('pw123456', 'c'.repeat(32));
  const parsed = parseStoredHash(stored);
  assert.equal(parsed.algorithm, 'pbkdf2-sha256');
  assert.equal(parsed.iterations, PBKDF2_ITERATIONS);
  assert.match(parsed.digest, /^[0-9a-f]{64}$/);
});

test('a different salt produces a different digest', async () => {
  const a = await hashPassword('same-password', 'd'.repeat(32));
  const b = await hashPassword('same-password', 'e'.repeat(32));
  assert.notEqual(parseStoredHash(a).digest, parseStoredHash(b).digest);
});

test('verification uses the count recorded in the stored hash, not the current constant', async () => {
  // The property that makes a future PBKDF2_ITERATIONS increase a forward
  // migration instead of a mass password reset. Derived here at a count the
  // current constant does not use.
  const salt = 'f'.repeat(32);
  const saltBytes = Uint8Array.from(salt.match(/../g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('legacy-pw'),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 1000, hash: 'SHA-256' },
    key,
    256
  );
  const digest = Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const storedAt1000 = `pbkdf2-sha256$1000$${digest}`;
  assert.equal(parseStoredHash(storedAt1000).iterations, 1000);
  // Verified with the *stored* count, so it still matches despite 1000 !== PBKDF2_ITERATIONS.
  assert.equal(await verifyPassword('legacy-pw', salt, storedAt1000), true);
  assert.equal(await verifyPassword('not-the-pw', salt, storedAt1000), false);
});

test('legacy bare-hex hashes are still parseable', () => {
  const parsed = parseStoredHash('deadbeef');
  assert.equal(parsed.algorithm, null);
  assert.equal(parsed.digest, 'deadbeef');
  assert.equal(parsed.iterations, PBKDF2_ITERATIONS);
});

test('timingSafeEqual compares without short-circuiting on length-equal input', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
  assert.equal(timingSafeEqual('', ''), true);
});
