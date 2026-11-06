import type { APIContext } from 'astro';
import { getDb, json, nowIso, readBody, requireAuth } from '@/lib/server/auth';
import { LEAD_STATUSES } from '@/lib/owner';
import { recordLeadEvent } from '@/lib/server/leads';

export const prerender = false;

const NOTES_MAX_LENGTH = 1000;

/**
 * PATCH /api/owner/leads/[id] — move a lead through the follow-up workflow
 * and/or save a private note.
 *
 * Authority comes from the listing: the lead must belong to one of the
 * caller's own listings, so a guessed lead id can never touch someone else's
 * inbox. Notes are the owner's private text and never leave this owner's API.
 */
export async function PATCH(context: APIContext) {
  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;
  if (auth.user.role !== 'owner' && !auth.user.is_admin) {
    return json({ error: 'Owner access required.' }, 403);
  }

  const id = Number(context.params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'Missing lead id.' }, 400);

  const body = (await readBody(context)) as Record<string, unknown> | null;
  const hasStatus = typeof body?.status === 'string' && body.status.trim().length > 0;
  const hasNotes = body?.notes !== undefined;

  if (!hasStatus && !hasNotes) return json({ error: 'Nothing to update.' }, 400);

  let status = '';
  if (hasStatus) {
    status = String(body!.status).trim();
    if (!(LEAD_STATUSES as readonly string[]).includes(status)) {
      return json({ error: 'Unknown lead status.' }, 400);
    }
  }

  let notes: string | null = null;
  if (hasNotes) {
    if (typeof body!.notes !== 'string') return json({ error: 'Notes must be text.' }, 400);
    notes = body!.notes.trim();
    if (notes.length > NOTES_MAX_LENGTH) {
      return json({ error: `Keep notes under ${NOTES_MAX_LENGTH} characters.` }, 400);
    }
    if (!notes) notes = null;
  }

  const db = getDb();
  const current = await db
    .prepare(
      `SELECT l.id, l.property_id, l.status
       FROM leads l
       WHERE l.id = ? AND l.property_id IN (SELECT id FROM owner_listings WHERE owner_id = ?)`
    )
    .bind(id, auth.user.id)
    .first<{ id: number; property_id: string; status: string }>();
  if (!current) return json({ error: 'Lead not found.' }, 404);

  const nextStatus = hasStatus ? status : current.status;
  const nextNotes = hasNotes ? notes : undefined;

  // Notes are written explicitly (not via COALESCE) so clearing a note to an
  // empty string really clears it.
  const res = hasNotes
    ? await db
        .prepare(
          `UPDATE leads SET status = ?, owner_notes = ?, updated_at = ?
           WHERE id = ? AND property_id IN (SELECT id FROM owner_listings WHERE owner_id = ?)`
        )
        .bind(nextStatus, nextNotes ?? null, nowIso(), id, auth.user.id)
        .run()
    : await db
        .prepare(
          `UPDATE leads SET status = ?, updated_at = ?
           WHERE id = ? AND property_id IN (SELECT id FROM owner_listings WHERE owner_id = ?)`
        )
        .bind(nextStatus, nowIso(), id, auth.user.id)
        .run();

  const changes = res.meta?.changes;
  if (typeof changes !== 'number' || changes === 0) return json({ error: 'Lead not found.' }, 404);

  if (nextStatus !== current.status) {
    await recordLeadEvent(db, {
      type: 'LEAD_STATUS_CHANGED',
      listingId: current.property_id,
      leadId: current.id,
      userId: auth.user.id,
    });
  }

  return json({ ok: true, status: nextStatus, notes: nextNotes === undefined ? undefined : nextNotes });
}
