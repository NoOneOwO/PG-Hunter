import type { APIContext } from 'astro';
import { getDb, json, nowIso, requireAuth } from '@/lib/server/auth';
import { fetchListing, listingDto } from '@/lib/server/listings';
import { mediaUrl } from '@/lib/server/media';

export const prerender = false;

/** Move a draft/rejected listing to `pending` for admin review. */
export async function POST(context: APIContext) {
  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;

  const db = getDb();
  const id = context.params.id ?? '';
  const row = await db
    .prepare('SELECT id, owner_id, status FROM owner_listings WHERE id = ?')
    .bind(id)
    .first<{ id: string; owner_id: string; status: string }>();
  if (!row) return json({ error: 'Listing not found.' }, 404);
  if (row.owner_id !== auth.user.id && !auth.user.is_admin) {
    return json({ error: 'Not your listing.' }, 403);
  }
  if (row.status !== 'draft' && row.status !== 'rejected') {
    return json({ error: `A listing with status "${row.status}" cannot be submitted.` }, 400);
  }

  await db
    .prepare("UPDATE owner_listings SET status = 'pending', rejection_reason = NULL, updated_at = ? WHERE id = ?")
    .bind(nowIso(), id)
    .run();

  const full = await fetchListing(db, id);
  if (!full) return json({ error: 'Listing not found.' }, 404);
  return json({ listing: listingDto(full.row, full.rooms, full.media, mediaUrl) });
}
