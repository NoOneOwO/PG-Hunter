import type { APIContext } from 'astro';
import {
  SESSION_COOKIE,
  createSession,
  getDb,
  hashPassword,
  json,
  publicUser,
  readBody,
  sessionCookieOpts,
  syncAdminFlag,
  timingSafeEqual,
  type UserRow,
} from '@/lib/server/auth';

export const prerender = false;

export async function POST(context: APIContext) {
  const db = getDb();
  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!email || !password) return json({ error: 'Please enter your email and password.' }, 400);

  const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  if (!user) return json({ error: 'Incorrect email or password. Please try again.' }, 401);

  if (!user.password_hash || !user.salt) {
    return json({ error: 'This account was created with Google. Continue with Google instead.' }, 401);
  }

  const hash = await hashPassword(password, user.salt);
  if (!timingSafeEqual(hash, user.password_hash)) {
    return json({ error: 'Incorrect email or password. Please try again.' }, 401);
  }

  if (await syncAdminFlag(db, user.email)) user.is_admin = 1;

  const token = await createSession(db, user.id);
  context.cookies.set(SESSION_COOKIE, token, sessionCookieOpts(context));
  return json({ user: publicUser(user) });
}
