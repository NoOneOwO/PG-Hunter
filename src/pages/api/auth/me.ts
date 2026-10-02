import type { APIContext } from 'astro';
import { currentUser, json, publicUser } from '@/lib/server/auth';

export const prerender = false;

export async function GET(context: APIContext) {
  const user = await currentUser(context);
  if (!user) return json({ user: null }, 401);
  return json({ user: publicUser(user) });
}
