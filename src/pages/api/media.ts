import type { APIContext } from 'astro';
import { currentUser, getDb, json, nowIso } from '@/lib/server/auth';
import {
  ALLOWED_DOC_TYPES,
  ALLOWED_IMAGE_TYPES,
  isMediaPurpose,
  mediaUrl,
  purposeToType,
  storeObject,
  validateFile,
} from '@/lib/server/media';

export const prerender = false;

/**
 * Upload a file (multipart/form-data).
 * Fields: `purpose` (listing-images | listing-documents | verification),
 * optional `listingId`, optional `docType` (for verification), `file`.
 */
export async function POST(context: APIContext) {
  const user = await currentUser(context);
  if (!user) return json({ error: 'Not logged in.' }, 401);
  if (user.role !== 'owner' && !user.is_admin) return json({ error: 'Owner access required.' }, 403);

  const form = await context.request.formData().catch(() => null);
  if (!form) return json({ error: 'Expected multipart form data.' }, 400);

  const purposeRaw = String(form.get('purpose') ?? '').trim();
  if (!isMediaPurpose(purposeRaw)) return json({ error: 'Unknown upload purpose.' }, 400);
  const purpose = purposeRaw;

  const listingId = String(form.get('listingId') ?? '').trim() || null;
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'Missing "file" field.' }, 400);

  const allowed = purpose === 'listing-images' ? ALLOWED_IMAGE_TYPES : ALLOWED_DOC_TYPES;
  const invalid = validateFile(file, allowed);
  if (invalid) return json({ error: invalid }, 400);

  const db = getDb();

  // Resolve the target listing BEFORE storing bytes. The old order saved the
  // object first and checked ownership afterwards, so a rejected upload still
  // left an orphan in R2. Admins may upload to an owner's listing (they set
  // pages up on owners' behalf) and the object is namespaced under that
  // owner's folder, not the admin's — a PG's assets stay in one place.
  let namespaceId = user.id;
  if (listingId) {
    const target = await db
      .prepare('SELECT id, owner_id FROM owner_listings WHERE id = ?')
      .bind(listingId)
      .first<{ id: string; owner_id: string }>();
    if (!target) return json({ error: 'Listing not found.' }, 404);
    if (target.owner_id !== user.id && !user.is_admin) {
      return json({ error: 'Not your listing.' }, 403);
    }
    namespaceId = target.owner_id;
  }

  const folder =
    purpose === 'verification'
      ? `verification/${user.id}`
      : `owners/${namespaceId}/${purpose}`;
  const key = await storeObject(folder, file.name, file.type, await file.arrayBuffer());

  if (purpose === 'verification') {
    const docId = crypto.randomUUID();
    const docType = String(form.get('docType') ?? '').trim() || 'identity';
    await db
      .prepare(
        'INSERT INTO verification_documents (id, owner_id, listing_id, doc_type, file_key, file_name, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(docId, user.id, listingId, docType, key, file.name, 'pending', nowIso())
      .run();
    return json({
      ok: true,
      file: { id: docId, key, url: mediaUrl(key), fileName: file.name, purpose },
    });
  }

  const mediaId = crypto.randomUUID();
  const sortRes = await db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM media WHERE listing_id = ?')
    .bind(listingId)
    .first<{ n: number }>();
  await db
    .prepare(
      'INSERT INTO media (id, listing_id, type, provider, external_id, title, sort_order, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(mediaId, listingId, purposeToType(purpose), 'r2', key, file.name, sortRes?.n ?? 0, user.id, nowIso())
    .run();

  return json({
    ok: true,
    file: { id: mediaId, key, url: mediaUrl(key), fileName: file.name, purpose },
  });
}
