import type { APIContext } from 'astro';
import {
  SESSION_COOKIE,
  createSession,
  generateSalt,
  getDb,
  hashPassword,
  json,
  nowIso,
  publicUser,
  readBody,
  sessionCookieOpts,
  syncAdminFlag,
  type UserRow,
} from '@/lib/server/auth';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(context: APIContext) {
  const db = getDb();
  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const role = body.role === 'owner' ? 'owner' : 'student';

  if (!name) return json({ error: 'Please enter your name.' }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: 'Please enter a valid email address.' }, 400);
  if (password.length < 6) return json({ error: 'Password must be at least 6 characters long.' }, 400);

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return json({ error: 'An account with this email already exists. Try logging in.' }, 409);

  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);
  const user: UserRow = {
    id: crypto.randomUUID(),
    email,
    password_hash: passwordHash,
    salt,
    provider: 'email',
    name,
    phone: null,
    college_slug: null,
    role,
    is_admin: 0,
    avatar_url: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, salt, provider, name, phone, college_slug, role, avatar_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      user.id,
      user.email,
      user.password_hash,
      user.salt,
      user.provider,
      user.name,
      user.phone,
      user.college_slug,
      user.role,
      user.avatar_url,
      user.created_at,
      user.updated_at
    )
    .run();

  if (await syncAdminFlag(db, user.email)) user.is_admin = 1;

  const token = await createSession(db, user.id);
  context.cookies.set(SESSION_COOKIE, token, sessionCookieOpts(context));
  return json({ user: publicUser(user) });
}
