import type { APIContext } from 'astro';
import { getDb, json, nowIso, readBody, requireAdmin } from '@/lib/server/auth';
import { fetchListing, listingDto } from '@/lib/server/listings';
import { mediaUrl } from '@/lib/server/media';

export const prerender = false;

const VALID_STATUSES = ['pending', 'active', 'rejected'];
const VALID_VERIFICATION = ['unverified', 'pg_hunter_verified', 'rishabh_irl_verified'];

export async function PUT(context: APIContext) {
  const admin = await requireAdmin(context);
  if ('error' in admin) return admin.error;

  const db = getDb();
  const id = context.params.id ?? '';
  const row = await db
    .prepare('SELECT id FROM owner_listings WHERE id = ?')
    .bind(id)
    .first<{ id: string }>();
  if (!row) return json({ error: 'Listing not found.' }, 404);

  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const status = String(body.status ?? '');
  if (!VALID_STATUSES.includes(status)) {
    return json({ error: `Status must be one of: ${VALID_STATUSES.join(', ')}.` }, 400);
  }

  const verificationStatus = body.verificationStatus
    ? String(body.verificationStatus)
    : undefined;
  if (verificationStatus && !VALID_VERIFICATION.includes(verificationStatus)) {
    return json({ error: 'Invalid verification status.' }, 400);
  }
  const rejectionReason =
    status === 'rejected' ? String(body.rejectionReason ?? '').trim() || 'Rejected by admin' : null;

  await db
    .prepare(
      `UPDATE owner_listings SET status = ?, verification_status = ?, rejection_reason = ?, updated_at = ? WHERE id = ?`
    )
    .bind(
      status,
      verificationStatus ?? (status === 'active' ? 'pg_hunter_verified' : undefined) ?? null,
      rejectionReason,
      nowIso(),
      id
    )
    .run();

  const full = await fetchListing(db, id);
  if (!full) return json({ error: 'Listing not found.' }, 404);
  return json({ listing: listingDto(full.row, full.rooms, full.media, mediaUrl) });
}
