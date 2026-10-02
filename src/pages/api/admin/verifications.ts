import type { APIContext } from 'astro';
import { getDb, json, requireAdmin } from '@/lib/server/auth';
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
  owner_name: string;
  owner_email: string;
  listing_name: string | null;
}

export async function GET(context: APIContext) {
  const admin = await requireAdmin(context);
  if ('error' in admin) return admin.error;

  const status = new URL(context.request.url).searchParams.get('status');

  const res = await getDb()
    .prepare(
      `SELECT d.*, u.name AS owner_name, u.email AS owner_email, ol.name AS listing_name
       FROM verification_documents d
       JOIN users u ON u.id = d.owner_id
       LEFT JOIN owner_listings ol ON ol.id = d.listing_id
       ${status && ['pending', 'approved', 'rejected'].includes(status) ? 'WHERE d.status = ?' : ''}
       ORDER BY d.created_at DESC`
    )
    .bind(...(status && ['pending', 'approved', 'rejected'].includes(status) ? [status] : []))
    .all<DocRow>();

  return json({
    documents: res.results.map((d) => ({
      id: d.id,
      ownerId: d.owner_id,
      ownerName: d.owner_name,
      ownerEmail: d.owner_email,
      listingId: d.listing_id,
      listingName: d.listing_name,
      docType: d.doc_type,
      fileName: d.file_name,
      url: mediaUrl(d.file_key),
      status: d.status,
      notes: d.notes,
      createdAt: d.created_at,
      reviewedAt: d.reviewed_at,
    })),
  });
}
