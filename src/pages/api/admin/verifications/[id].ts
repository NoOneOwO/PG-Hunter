import type { APIContext } from 'astro';
import { getDb, json, nowIso, readBody, requireAdmin } from '@/lib/server/auth';
import { mediaUrl } from '@/lib/server/media';

export const prerender = false;

interface DocRow {
  id: string;
  owner_id: string;
  listing_id: string | null;
  status: 'pending' | 'approved' | 'rejected';
  file_key: string;
}

export async function PUT(context: APIContext) {
  const admin = await requireAdmin(context);
  if ('error' in admin) return admin.error;

  const db = getDb();
  const id = context.params.id ?? '';
  const doc = await db
    .prepare('SELECT id, owner_id, listing_id, status FROM verification_documents WHERE id = ?')
    .bind(id)
    .first<DocRow>();
  if (!doc) return json({ error: 'Document not found.' }, 404);

  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const decision = String(body.decision ?? '');
  if (decision !== 'approved' && decision !== 'rejected') {
    return json({ error: 'Decision must be "approved" or "rejected".' }, 400);
  }
  const notes = String(body.notes ?? '').trim() || null;

  await db
    .prepare('UPDATE verification_documents SET status = ?, notes = ?, reviewed_at = ? WHERE id = ?')
    .bind(decision, notes, nowIso(), id)
    .run();

  // Approving a document marks the related listing verified (when one is set).
  if (decision === 'approved' && doc.listing_id) {
    await db
      .prepare(
        `UPDATE owner_listings SET verification_status = 'pg_hunter_verified', updated_at = ? WHERE id = ? AND verification_status = 'unverified'`
      )
      .bind(nowIso(), doc.listing_id)
      .run();
  }

  const updated = await db
    .prepare(
      `SELECT d.*, u.name AS owner_name, u.email AS owner_email, ol.name AS listing_name
       FROM verification_documents d
       JOIN users u ON u.id = d.owner_id
       LEFT JOIN owner_listings ol ON ol.id = d.listing_id
       WHERE d.id = ?`
    )
    .bind(id)
    .first<DocRow & { owner_name: string; owner_email: string; listing_name: string | null }>();

  return json({
    document: {
      id: updated?.id ?? id,
      ownerId: updated?.owner_id ?? doc.owner_id,
      ownerName: updated?.owner_name ?? null,
      ownerEmail: updated?.owner_email ?? null,
      listingId: updated?.listing_id ?? doc.listing_id,
      listingName: updated?.listing_name ?? null,
      status: decision,
      notes,
      url: updated ? mediaUrl(updated.file_key as string) : null,
    },
  });
}
