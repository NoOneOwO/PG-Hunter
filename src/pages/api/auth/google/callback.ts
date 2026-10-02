import type { APIContext } from 'astro';
import {
  SESSION_COOKIE,
  createSession,
  getDb,
  nowIso,
  safePath,
  sessionCookieOpts,
  syncAdminFlag,
  type UserRow,
} from '@/lib/server/auth';
import { exchangeGoogleCode, oauthCallbackParams, popOAuthNext, popOAuthRole, verifyOAuthState } from '@/lib/server/oauth';

export const prerender = false;

export async function GET(context: APIContext) {
  const params = oauthCallbackParams(context);
  const code = params.get('code');
  const error = params.get('error');

  if (error || !code) return context.redirect('/login?error=google-denied');
  if (!verifyOAuthState(context, params.get('state'))) return context.redirect('/login?error=google-failed');

  const profile = await exchangeGoogleCode(context, code);
  if (!profile) return context.redirect('/login?error=google-failed');

  const db = getDb();
  const now = nowIso();
  // Role requested via ?role=owner on the initial /api/auth/google call.
  // Existing users keep their stored role; this only affects brand-new Google accounts.
  const requestedRole = popOAuthRole(context);
  const existing = await db.prepare('SELECT * FROM users WHERE email = ?').bind(profile.email).first<UserRow>();

  let user: UserRow;
  if (existing) {
    await db
      .prepare(`UPDATE users SET provider = 'google', name = ?, avatar_url = ?, updated_at = ? WHERE id = ?`)
      .bind(profile.name, profile.picture, now, existing.id)
      .run();
    user = { ...existing, provider: 'google', name: profile.name, avatar_url: profile.picture, updated_at: now };
  } else {
    const newRole = requestedRole === 'owner' ? 'owner' : 'student';
    user = {
      id: crypto.randomUUID(),
      email: profile.email,
      password_hash: null,
      salt: null,
      provider: 'google',
      name: profile.name,
      phone: null,
      college_slug: null,
      role: newRole,
      is_admin: 0,
      avatar_url: profile.picture,
      created_at: now,
      updated_at: now,
    };
    await db
      .prepare(
        `INSERT INTO users (id, email, password_hash, salt, provider, name, phone, college_slug, role, avatar_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(user.id, user.email, null, null, 'google', user.name, null, null, newRole, user.avatar_url, now, now)
      .run();
  }

  if (await syncAdminFlag(db, user.email)) user.is_admin = 1;

  const token = await createSession(db, user.id);
  context.cookies.set(SESSION_COOKIE, token, sessionCookieOpts(context));
  return context.redirect(safePath(popOAuthNext(context)));
}
