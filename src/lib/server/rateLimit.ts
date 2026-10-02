/**
 * PG Hunter — D1-backed fixed-window rate limiting.
 *
 * Cloudflare-appropriate MVP. Counters live in the D1 binding the Worker
 * already has, so there is no new service to provision and no external
 * dependency. This is intentionally a simple fixed window, not a distributed
 * sliding-window system.
 *
 * Privacy: the raw caller identifier (IP address or user id) is never stored.
 * It is hashed before it becomes a primary key. If `RATE_LIMIT_SALT` is set
 * the hash is HMAC'd with it, which stops the identifier being recovered by
 * brute-forcing the IPv4 space against a plain digest.
 *
 * Failure mode: if the counter query itself fails we allow the request
 * through. A rate limiter must never be the reason the site goes down, and a
 * missing/broken counter table should not turn into a self-inflicted outage.
 * The error is logged so it is visible in Workers Logs.
 */

export interface RateLimitPolicy {
  /** Maximum hits allowed within one window. */
  limit: number;
  /** Length of the fixed window, in seconds. */
  windowSeconds: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  hits: number;
  /** Seconds until the current window rolls over. 0 when allowed. */
  retryAfterSeconds: number;
  windowSeconds: number;
}

/** Per-route policies. Keys are matched against the request path. */
export const RATE_LIMITS = {
  /** Password + Google-signin attempts. */
  auth_login: { limit: 10, windowSeconds: 15 * 60 },
  /** Account creation. */
  auth_register: { limit: 5, windowSeconds: 60 * 60 },
  /** Kicking off the Google OAuth dance. */
  auth_oauth_start: { limit: 20, windowSeconds: 15 * 60 },
  /** Public listing view counter -- unauthenticated, per IP. */
  views: { limit: 60, windowSeconds: 60 },
  /** Student -> owner enquiry. */
  enquiries: { limit: 10, windowSeconds: 60 * 60 },
  /** Student experience submissions. */
  experiences: { limit: 5, windowSeconds: 60 * 60 },
  /** Report abuse. */
  reports: { limit: 10, windowSeconds: 60 * 60 },
  /** Owner media uploads. */
  media_upload: { limit: 30, windowSeconds: 60 * 60 },
  /** Anything else that mutates state and is reachable while logged out. */
  api_write: { limit: 30, windowSeconds: 60 * 60 },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitScope = keyof typeof RATE_LIMITS;

/** IPv4/IPv6 -> opaque 32-byte digest, hex encoded. */
const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const importHmacKey = (secret: string) =>
  crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

/**
 * Hash a raw caller identifier into an opaque token.
 *
 * `salt` is optional; without it this is a plain SHA-256 digest, which is
 * still better than storing the identifier in the clear.
 */
export const hashIdentifier = async (identifier: string, salt?: string): Promise<string> => {
  const message = new TextEncoder().encode(identifier);
  if (salt) {
    const key = await importHmacKey(salt);
    return toHex(await crypto.subtle.sign('HMAC', key, message));
  }
  return toHex(await crypto.subtle.digest('SHA-256', message));
};

/**
 * Resolve who to count against: the authenticated user when there is one,
 * otherwise the connecting IP.
 */
export const callerIdentifier = (request: Request, userId?: string | null): string => {
  if (userId) return `u:${userId}`;
  // Cloudflare always sets CF-Connecting-IP on Worker requests. The fallbacks
  // only matter in local `wrangler dev`.
  const ip =
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'unknown';
  return `ip:${ip}`;
};

/** Best-effort cleanup of windows that can no longer be hit. */
let cleanupTick = 0;
const maybeCleanup = async (db: D1Database): Promise<void> => {
  if (cleanupTick++ % 100 !== 0) return;
  try {
    await db
      .prepare('DELETE FROM rate_limits WHERE window_start < ?')
      .bind(Math.floor(Date.now() / 1000) - 24 * 60 * 60)
      .run();
  } catch {
    // Never let housekeeping break a request.
  }
};

/**
 * Count one hit against `scope` and report whether it is within budget.
 *
 * A single `INSERT ... ON CONFLICT ... RETURNING` keeps the read-modify-write
 * atomic, which matters because D1 can serve concurrent Workers.
 */
export const consumeRateLimit = async (
  db: D1Database,
  scope: RateLimitScope,
  rawIdentifier: string,
  options: { salt?: string; now?: number } = {}
): Promise<RateLimitDecision> => {
  const policy: RateLimitPolicy = RATE_LIMITS[scope];
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  const windowStart = Math.floor(nowSeconds / policy.windowSeconds) * policy.windowSeconds;
  const identifier = await hashIdentifier(rawIdentifier, options.salt);

  try {
    const row = await db
      .prepare(
        `INSERT INTO rate_limits (scope, identifier, window_start, hits)
         VALUES (?1, ?2, ?3, 1)
         ON CONFLICT(scope, identifier, window_start)
         DO UPDATE SET hits = hits + 1
         RETURNING hits`
      )
      .bind(scope, identifier, windowStart)
      .first<{ hits: number }>();

    const hits = row?.hits ?? 1;
    const allowed = hits <= policy.limit;
    return {
      allowed,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - hits),
      hits,
      // Seconds until the current fixed window rolls over.
      retryAfterSeconds: allowed ? 0 : windowStart + policy.windowSeconds - nowSeconds,
      windowSeconds: policy.windowSeconds,
    };
  } catch (err) {
    console.error(`rate_limit: falling open for scope=${scope}`, err);
    return {
      allowed: true,
      limit: policy.limit,
      remaining: policy.limit,
      hits: 0,
      retryAfterSeconds: 0,
      windowSeconds: policy.windowSeconds,
    };
  }
};

/** Standard 429 body + headers. */
export const rateLimitResponse = (decision: RateLimitDecision, scope: string): Response =>
  new Response(
    JSON.stringify({
      error: 'Too many requests. Please slow down and try again shortly.',
      scope,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.max(1, decision.retryAfterSeconds)),
        'X-RateLimit-Limit': String(decision.limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Scope': scope,
      },
    }
  );

/** Called opportunistically so the table does not grow without bound. */
export const sweepRateLimits = (db: D1Database): Promise<void> => maybeCleanup(db);
