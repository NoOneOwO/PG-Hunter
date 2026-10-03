/**
 * PG Hunter — password hashing (PBKDF2-SHA256 via WebCrypto).
 *
 * Deliberately dependency-free (no `cloudflare:workers` import) so it can be
 * unit tested under plain Node — see test/password.test.mts.
 *
 * ── The workerd iteration cap ──────────────────────────────────────────────
 * The Workers runtime refuses PBKDF2 with more than 100,000 iterations:
 *
 *   NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not
 *   supported (requested 210000).
 *
 * Node has no such limit, so a larger value works in tests and in `astro dev`
 * but throws an uncaught 500 on every real signup AND every password login in
 * production. `PBKDF2_ITERATIONS` is therefore a single exported constant and
 * test/password.test.mts asserts it stays within the runtime's ceiling.
 *
 * ── Stored format ─────────────────────────────────────────────────────────
 * Hashes are stored as `pbkdf2-sha256$<iterations>$<hex digest>`. The parameters
 * travel with the digest, so raising `PBKDF2_ITERATIONS` later cannot silently
 * invalidate existing passwords — `verifyPassword` re-derives using the count
 * recorded in the stored value, not the current constant.
 *
 * (Legacy rows written before this format existed are bare hex digests; those
 * are verified with the current constant and continue to work.)
 */

/** workerd rejects anything above 100_000; stay at the ceiling, not past it. */
export const PBKDF2_ITERATIONS = 100_000;

/** The maximum the Workers runtime accepts. Do not exceed. */
export const WORKERD_MAX_PBKDF2_ITERATIONS = 100_000;

const PBKDF2_ALGORITHM = 'pbkdf2-sha256';

const hexBytes = (hex: string): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(Math.max(0, hex.length >> 1)));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Derive the raw digest for an explicit iteration count. */
const derive = async (
  password: string,
  saltHex: string,
  iterations: number
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexBytes(saltHex), iterations, hash: 'SHA-256' },
    key,
    256
  );
  return bytesToHex(new Uint8Array(bits));
};

/** Hash a password for storage, recording the parameters used. */
export const hashPassword = async (password: string, saltHex: string): Promise<string> => {
  const digest = await derive(password, saltHex, PBKDF2_ITERATIONS);
  return `${PBKDF2_ALGORITHM}$${PBKDF2_ITERATIONS}$${digest}`;
};

/** Parse a stored hash into its algorithm, iteration count and digest. */
export const parseStoredHash = (
  stored: string
): { algorithm: string | null; iterations: number; digest: string } => {
  const parts = stored.split('$');
  if (parts.length === 3) {
    const iterations = Number.parseInt(parts[1], 10);
    if (Number.isFinite(iterations) && iterations > 0) {
      return { algorithm: parts[0], iterations, digest: parts[2] };
    }
  }
  // Legacy bare-hex digest: assume the current parameters.
  return { algorithm: null, iterations: PBKDF2_ITERATIONS, digest: stored };
};

/**
 * Verify a password against a stored hash.
 *
 * Re-derives with the iteration count recorded in the stored value so that
 * changing `PBKDF2_ITERATIONS` never locks existing users out.
 */
export const verifyPassword = async (
  password: string,
  saltHex: string,
  stored: string
): Promise<boolean> => {
  const { iterations, digest } = parseStoredHash(stored);
  const candidate = await derive(password, saltHex, iterations);
  return timingSafeEqual(candidate, digest);
};

/** Constant-time string comparison — never short-circuits on first difference. */
export const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
