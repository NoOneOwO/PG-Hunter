-- PG Hunter — P0 hardening: fixed-window rate limiting counters.
--
-- Cloudflare-appropriate MVP: counters live in the D1 binding the Worker
-- already has, so there is no new service, no Redis and no external
-- dependency to provision. This is deliberately not a distributed
-- sliding-window system.
--
-- `identifier` is a SHA-256 hash, never a raw IP address or user id, so the
-- table holds no directly identifying data. See src/lib/server/rateLimit.ts.
--
-- Cloudflare also offers WAF Rate Limiting Rules at the edge, which is a
-- strictly better long-term layer. This table backs per-route application
-- limits that the edge cannot express (e.g. "5 registrations per user").

CREATE TABLE IF NOT EXISTS rate_limits (
  -- Route policy key, e.g. 'auth_login'.
  scope        TEXT NOT NULL,
  -- SHA-256 hex digest of the caller identity.
  identifier   TEXT NOT NULL,
  -- Fixed-window start, unix seconds (floor(now / windowSeconds) * windowSeconds).
  window_start INTEGER NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (scope, identifier, window_start)
);

-- Supports opportunistic cleanup of windows that can no longer be hit.
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);
