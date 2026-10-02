import type { APIContext } from 'astro';
import { getDb, json, requireAuth } from '@/lib/server/auth';
import { mediaUrl } from '@/lib/server/media';

export const prerender = false;

interface DocRow {
  id: string;
  owner_id: string;
  listing_id: string | null;
  doc_type: string;
  file_key: string;
  file_name: string;
  status: 'pending' | 'approved' | 'rejected';
  notes: string | null;
  created_at: string;
  reviewed_at: string | null;
}

/**
 * Verification state for the owner. Documents are uploaded via
 * POST /api/media with purpose=verification (multipart).
 */
export async function GET(context: APIContext) {
  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;
  if (auth.user.role !== 'owner' && !auth.user.is_admin) {
    return json({ error: 'Owner access required.' }, 403);
  }

  const db = getDb();
  const docsRes = await db
    .prepare('SELECT * FROM verification_documents WHERE owner_id = ? ORDER BY created_at DESC')
    .bind(auth.user.id)
    .all<DocRow>();

  const documents = docsRes.results.map((d) => ({
    id: d.id,
    listingId: d.listing_id,
    docType: d.doc_type,
    fileName: d.file_name,
    url: mediaUrl(d.file_key),
    status: d.status,
    notes: d.notes,
    createdAt: d.created_at,
    reviewedAt: d.reviewed_at,
  }));

  const status: 'none' | 'pending' | 'approved' =
    documents.some((d) => d.status === 'pending')
      ? 'pending'
      : documents.length > 0 && documents.every((d) => d.status === 'approved')
        ? 'approved'
        : 'none';

  return json({ status, documents });
}
