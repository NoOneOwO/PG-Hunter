import type { APIContext } from 'astro';
import { currentUser, getDb, json, nowIso, publicUser, readBody } from '@/lib/server/auth';

export const prerender = false;

/** Trim a free-text patch value, collapsing blank strings to null. */
const text = (value: unknown, max: number): string | null =>
  String(value ?? '').trim().slice(0, max) || null;

/** Field caps — mirrors the profile form's own limits. */
const LIMITS = {
  name: 80,
  phone: 24,
  college: 64,
  city: 60,
  movingInMonth: 7, // 'YYYY-MM'
  budgetPref: 16, // 'under-10' | '10-15' | '15-20' | '20-plus'
  availability: 120,
  message: 500,
} as const;

export async function PUT(context: APIContext) {
  const user = await currentUser(context);
  if (!user) return json({ error: 'Not logged in.' }, 401);

  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  // `undefined` means "not part of this patch", so a single-field update never
  // clears the rest of the profile.
  const name = body.name !== undefined ? text(body.name, LIMITS.name) : undefined;
  const phone = body.phone !== undefined ? text(body.phone, LIMITS.phone) : undefined;
  const collegeSlug =
    body.collegeSlug !== undefined ? text(body.collegeSlug, LIMITS.college) : undefined;
  const city = body.city !== undefined ? text(body.city, LIMITS.city) : undefined;
  const movingInMonth =
    body.movingInMonth !== undefined ? text(body.movingInMonth, LIMITS.movingInMonth) : undefined;
  const budgetPref =
    body.budgetPref !== undefined ? text(body.budgetPref, LIMITS.budgetPref) : undefined;
  const availability =
    body.availability !== undefined ? text(body.availability, LIMITS.availability) : undefined;
  const messageToOwners =
    body.messageToOwners !== undefined ? text(body.messageToOwners, LIMITS.message) : undefined;

  if (name !== undefined && !name) return json({ error: 'Name cannot be empty.' }, 400);
  if (phone && !/^[+()\d\s-]{7,24}$/.test(phone)) {
    return json({ error: 'Enter a valid phone number (7–15 digits).' }, 400);
  }
  if (movingInMonth && !/^\d{4}-\d{2}$/.test(movingInMonth)) {
    return json({ error: 'Move-in month must look like 2026-11.' }, 400);
  }

  const newName = name ?? user.name;
  const newPhone = phone !== undefined ? phone : user.phone;
  const newCollege = collegeSlug !== undefined ? collegeSlug : user.college_slug;
  const newCity = city !== undefined ? city : user.city;
  const newMovingIn = movingInMonth !== undefined ? movingInMonth : user.moving_in_month;
  const newBudget = budgetPref !== undefined ? budgetPref : user.budget_pref;
  const newAvailability = availability !== undefined ? availability : user.availability;
  const newMessage = messageToOwners !== undefined ? messageToOwners : user.message_to_owners;
  const updatedAt = nowIso();

  await getDb()
    .prepare(
      `UPDATE users SET name = ?, phone = ?, college_slug = ?, city = ?, moving_in_month = ?,
       budget_pref = ?, availability = ?, message_to_owners = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(
      newName,
      newPhone,
      newCollege,
      newCity,
      newMovingIn,
      newBudget,
      newAvailability,
      newMessage,
      updatedAt,
      user.id
    )
    .run();

  return json({
    user: publicUser({
      ...user,
      name: newName,
      phone: newPhone,
      college_slug: newCollege,
      city: newCity,
      moving_in_month: newMovingIn,
      budget_pref: newBudget,
      availability: newAvailability,
      message_to_owners: newMessage,
      updated_at: updatedAt,
    }),
  });
}
