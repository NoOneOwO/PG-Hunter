import type { APIContext } from 'astro';
import { SESSION_COOKIE, destroySession, getDb, json } from '@/lib/server/auth';

export const prerender = false;

export async function POST(context: APIContext) {
  const token = context.cookies.get(SESSION_COOKIE)?.value;
  await destroySession(getDb(), token);
  context.cookies.delete(SESSION_COOKIE, { path: '/' });
  return json({ ok: true });
}
