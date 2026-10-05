/**
 * PG Hunter — server-side helpers for the Cloudflare Worker API.
 *
 * Everything here runs inside the Worker (workerd), never in the browser.
 * Bindings (D1, secrets) arrive via `import { env } from 'cloudflare:workers'`
 * (the @astrojs/cloudflare v13 pattern — Astro.locals.runtime is gone).
 * Run `npx wrangler types` after changing wrangler.toml to refresh
 * worker-configuration.d.ts.
 */

import { env } from 'cloudflare:workers';
import type { APIContext } from 'astro';

import { mediaUrl } from './media';

/** A row from the `users` table (auth + profile in one place for the MVP). */
export interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  salt: string | null;
  provider: 'email' | 'google';
  name: string;
  phone: string | null;
  college_slug: string | null;
  city: string | null;
  moving_in_month: string | null;
  budget_pref: string | null;
  availability: string | null;
  message_to_owners: string | null;
  role: 'student' | 'owner';
  is_admin: number;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export const SESSION_COOKIE = 'ph_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

/* ------------------------------------------------------------------ */
/* Context helpers                                                     */
/* ------------------------------------------------------------------ */

export const getDb = (): D1Database => env.DB;

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

/** Parse a JSON request body, returning null when absent or malformed. */
export const readBody = async (context: APIContext): Promise<any> => {
  try {
    return await context.request.json();
  } catch {
    return null;
  }
};

/**
 * The real request URL. In this Astro 6 + Cloudflare setup the static pages
 * drop query strings, so API routes always parse from `context.request.url`.
 */
export const getRequestUrl = (context: APIContext): URL => new URL(context.request.url);

/** Origin used for OAuth redirect URIs — overridable via SITE_URL var. */
export const getSiteUrl = (context: APIContext): string => {
  const override = env.SITE_URL?.trim();
  if (override) return override.replace(/\/+$/, '');
  return getRequestUrl(context).origin;
};

/** Only allow same-site, same-origin paths for redirects (open-redirect guard). */
export const safePath = (path: string | null | undefined): string =>
  path && path.startsWith('/') && !path.startsWith('//') ? path : '/';

/** True when cookies can be marked Secure (https request or https SITE_URL). */
export const isSecureRequest = (context: APIContext): boolean =>
  getRequestUrl(context).protocol === 'https:' || env.SITE_URL?.startsWith('https') === true;

export const nowIso = (): string => new Date().toISOString();

export const randomHex = (bytes: number): string => {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
};

/* ------------------------------------------------------------------ */
/* Password hashing                                                    */
/* ------------------------------------------------------------------ */

/**
 * The hashing primitives live in ./password so they stay importable from plain
 * Node (this module pulls in `cloudflare:workers`). Re-exported here because
 * existing callers import them from this module.
 */
export {
  PBKDF2_ITERATIONS,
  hashPassword,
  verifyPassword,
  parseStoredHash,
  timingSafeEqual,
} from './password';

export const generateSalt = (): string => randomHex(16);

/* ------------------------------------------------------------------ */
/* Sessions + cookies                                                  */
/* ------------------------------------------------------------------ */

export const createSession = async (db: D1Database, userId: string): Promise<string> => {
  const token = randomHex(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await db
    .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, userId, expiresAt)
    .run();
  return token;
};

/** Resolve a session token to its user, or null when invalid/expired. */
export const getUserFromSession = async (db: D1Database, token: string | undefined): Promise<UserRow | null> => {
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.password_hash, u.salt, u.provider, u.name, u.phone,
              u.college_slug, u.city, u.moving_in_month, u.budget_pref, u.availability,
              u.message_to_owners, u.role, u.is_admin, u.avatar_url, u.created_at, u.updated_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    )
    .bind(token, nowIso())
    .first<UserRow>();
  return row ?? null;
};

export const destroySession = async (db: D1Database, token: string | undefined): Promise<void> => {
  if (!token) return;
  await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
};

/** Session cookie options. Secure only over https (or an https SITE_URL). */
export const sessionCookieOpts = (context: APIContext) => ({
  httpOnly: true,
  secure: isSecureRequest(context),
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_TTL_SECONDS,
});

/** The logged-in user for this request, or null. */
export const currentUser = async (context: APIContext): Promise<UserRow | null> =>
  getUserFromSession(getDb(), context.cookies.get(SESSION_COOKIE)?.value);

/**
 * Grant admin to users whose email is listed in the ADMIN_EMAILS var.
 * Called on register/login so promoted emails take effect immediately.
 * Returns true when the user was promoted to admin.
 */
export const syncAdminFlag = async (db: D1Database, email: string): Promise<boolean> => {
  const list = (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return false;
  if (!list.includes(email.toLowerCase())) return false;
  await db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').bind(email.toLowerCase()).run();
  return true;
};

/** True when the logged-in user is an admin. */
export const isAdmin = (user: UserRow | null): boolean => Boolean(user?.is_admin);

/**
 * Resolve the current user, returning a 401/403 JSON response when missing.
 * Returns `null` (caller proceeds) when the user is valid.
 */
export const requireAuth = async (
  context: APIContext
): Promise<{ user: UserRow } | { error: Response }> => {
  const user = await currentUser(context);
  if (!user) return { error: json({ error: 'Not logged in.' }, 401) };
  return { user };
};

/** Like requireAuth but also enforces the admin flag. */
export const requireAdmin = async (
  context: APIContext
): Promise<{ user: UserRow } | { error: Response }> => {
  const auth = await requireAuth(context);
  if ('error' in auth) return auth;
  if (!isAdmin(auth.user)) return { error: json({ error: 'Admin access required.' }, 403) };
  return auth;
};

/* ------------------------------------------------------------------ */
/* Serialization                                                       */
/* ------------------------------------------------------------------ */

/**
 * `users.avatar_url` holds either:
 *   - an R2 object key (avatars/{userId}/{uuid}.webp) for uploaded photos, or
 *   - an absolute https URL for accounts whose picture comes from Google.
 *
 * Only the R2 key is rewritten into the /api/media route; an absolute URL is
 * passed through untouched. Prefixing the Google URL produced
 * `/api/media/https://lh3.googleusercontent.com/...`, which 404s and left the
 * profile showing a broken-image icon after every fresh sign-in.
 */
const avatarUrl = (value: string | null): string | null => {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return value.startsWith('/') ? value : mediaUrl(value);
};

/** The app-facing user object (never includes password material). */
export const publicUser = (u: UserRow) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  isAdmin: Boolean(u.is_admin),
  phone: u.phone ?? undefined,
  collegeSlug: u.college_slug ?? undefined,
  city: u.city ?? undefined,
  movingInMonth: u.moving_in_month ?? undefined,
  budgetPref: u.budget_pref ?? undefined,
  availability: u.availability ?? undefined,
  messageToOwners: u.message_to_owners ?? undefined,
  avatar: avatarUrl(u.avatar_url),
  createdAt: u.created_at,
  provider: u.provider,
});

export type PublicUser = ReturnType<typeof publicUser>;
