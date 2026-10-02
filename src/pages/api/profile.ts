import type { APIContext } from 'astro';
import { currentUser, getDb, json, nowIso, publicUser, readBody } from '@/lib/server/auth';

export const prerender = false;

export async function PUT(context: APIContext) {
  const user = await currentUser(context);
  if (!user) return json({ error: 'Not logged in.' }, 401);

  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const name = body.name !== undefined ? String(body.name).trim() : undefined;
  const phone = body.phone !== undefined ? String(body.phone).trim() : undefined;
  const collegeSlug =
    body.collegeSlug !== undefined ? String(body.collegeSlug).trim() || null : undefined;

  if (name !== undefined && !name) return json({ error: 'Name cannot be empty.' }, 400);

  const newName = name ?? user.name;
  const newPhone = phone !== undefined ? phone : user.phone ?? '';
  const newCollege = collegeSlug !== undefined ? collegeSlug : user.college_slug;
  const updatedAt = nowIso();

  await getDb()
    .prepare('UPDATE users SET name = ?, phone = ?, college_slug = ?, updated_at = ? WHERE id = ?')
    .bind(newName, newPhone, newCollege, updatedAt, user.id)
    .run();

  return json({
    user: publicUser({
      ...user,
      name: newName,
      phone: newPhone || null,
      college_slug: newCollege,
      updated_at: updatedAt,
    }),
  });
}
