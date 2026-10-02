import type { APIContext } from 'astro';
import { getDb, json, nowIso, readBody, requireAdmin } from '@/lib/server/auth';
import { mediaUrl } from '@/lib/server/media';
import { effectiveVerificationStatus } from '@/lib/verificationRules';

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

  // Approving a document does NOT verify the listing.
  //
  // It used to, and that was wrong twice over: it granted a trust badge as a
  // side effect of a paperwork decision, and it bypassed the verification
  // ledger entirely, leaving no record of who claimed what or on what
  // evidence. A reviewer who has genuinely established the claim grants it
  // explicitly through PUT /api/admin/listings/:id with action=grant,
  // which writes an auditable ledger row. The response reports whether that
  // step is still outstanding so the UI can prompt for it.
  let listingVerificationStatus: string | null = null;
  if (doc.listing_id) {
    const listing = await db
      .prepare(
        'SELECT verification_status, verification_expires_at FROM owner_listings WHERE id = ?'
      )
      .bind(doc.listing_id)
      .first<{ verification_status: string; verification_expires_at: string | null }>();
    // Report the EFFECTIVE status, not the stored column. A pre-hardening
    // badge may still sit in `verification_status` with an expiry in the past
    // (those rows have no ledger entry at all). Reporting the raw column would
    // tell an admin "verified" while the public listing correctly shows no
    // badge — exactly the kind of mismatch that made verification untrustworthy.
    listingVerificationStatus = listing
      ? effectiveVerificationStatus({
          verification_status: listing.verification_status,
          verification_expires_at: listing.verification_expires_at,
        })
      : null;
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
    // Present when the document was tied to a specific listing: tells the
    // admin whether an explicit verification grant is still required.
    listingId: doc.listing_id,
    listingVerificationStatus,
    verificationGrantRequired:
      decision === 'approved' && Boolean(doc.listing_id) && listingVerificationStatus === 'unverified',
  });
}
