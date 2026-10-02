import type { APIContext } from 'astro';
import { getDb, json, nowIso, readBody, requireAuth } from '@/lib/server/auth';
import { deleteObject } from '@/lib/server/media';

export const prerender = false;

/** Supported video providers and their URL patterns. */
const VIDEO_PROVIDERS = [
  {
    name: 'youtube',
    patterns: [
      /(?:youtube\.com\/watch\?.*?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{6,20})/,
    ],
  },
] as const;

type VideoProvider = (typeof VIDEO_PROVIDERS)[number]['name'];

interface ParsedVideo {
  provider: VideoProvider;
  videoId: string;
}

/** Try to extract a video ID and provider from a URL or bare ID. */
const parseVideoUrl = (input: string): ParsedVideo | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  for (const provider of VIDEO_PROVIDERS) {
    for (const pattern of provider.patterns) {
      const match = trimmed.match(pattern);
      if (match) return { provider: provider.name, videoId: match[1] };
    }
  }

  // Bare YouTube ID (no URL, just the 11-char code)
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
    return { provider: 'youtube', videoId: trimmed };
  }

  return null;
};

/** Ensure the listing belongs to the caller (admins may also manage). */
const ownedListingId = async (
  context: APIContext,
  listingId: string
): Promise<{ listingId: string; userId: string } | Response> => {
  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;
  if (auth.user.role !== 'owner' && !auth.user.is_admin) {
    return json({ error: 'Owner access required.' }, 403);
  }

  const db = getDb();
  const row = await db
    .prepare('SELECT id FROM owner_listings WHERE id = ? AND owner_id = ?')
    .bind(listingId, auth.user.id)
    .first<{ id: string }>();
  if (!row) return json({ error: 'Listing not found.' }, 404);
  return { listingId: row.id, userId: auth.user.id };
};

/**
 * POST /api/owner/media
 *
 * Add a video embed to a listing.
 * Body: { listingId, url, title? }
 */
export async function POST(context: APIContext) {
  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const listingId = String(body.listingId ?? '').trim();
  const url = String(body.url ?? '').trim();
  const title = String(body.title ?? '').trim() || 'Room tour';

  if (!listingId) return json({ error: 'listingId is required.' }, 400);
  if (!url) return json({ error: 'Please enter a video URL.' }, 400);

  const owned = await ownedListingId(context, listingId);
  if (owned instanceof Response) return owned;

  const parsed = parseVideoUrl(url);
  if (!parsed) {
    return json(
      {
        error:
          'Could not parse a video URL. Supported: YouTube links or a bare YouTube video ID.',
      },
      400
    );
  }

  const db = getDb();

  // Check for duplicate video on this listing
  const existing = await db
    .prepare(
      'SELECT id FROM media WHERE listing_id = ? AND provider = ? AND external_id = ?'
    )
    .bind(listingId, parsed.provider, parsed.videoId)
    .first<{ id: string }>();
  if (existing) {
    return json({ error: 'This video is already added to this listing.' }, 409);
  }

  const sortRes = await db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM media WHERE listing_id = ?')
    .bind(listingId)
    .first<{ n: number }>();

  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO media (id, listing_id, type, provider, external_id, title, sort_order, uploaded_by, created_at) VALUES (?, ?, 'video', ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      id,
      listingId,
      parsed.provider,
      parsed.videoId,
      title,
      sortRes?.n ?? 0,
      owned.userId,
      nowIso()
    )
    .run();

  return json(
    {
      ok: true,
      media: {
        id,
        type: 'video',
        provider: parsed.provider,
        externalId: parsed.videoId,
        url: null,
        title,
      },
    },
    201
  );
}

/**
 * PUT /api/owner/media
 *
 * Reorder media items on a listing.
 * Body: { listingId, mediaIds: string[] }  — order of IDs = desired sort_order.
 */
export async function PUT(context: APIContext) {
  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const listingId = String(body.listingId ?? '').trim();
  const mediaIds = Array.isArray(body.mediaIds) ? body.mediaIds : [];

  if (!listingId) return json({ error: 'listingId is required.' }, 400);
  if (mediaIds.length === 0) return json({ error: 'mediaIds array is required.' }, 400);

  const owned = await ownedListingId(context, listingId);
  if (owned instanceof Response) return owned;

  const db = getDb();

  for (let i = 0; i < mediaIds.length; i++) {
    await db
      .prepare(
        'UPDATE media SET sort_order = ? WHERE id = ? AND listing_id = ?'
      )
      .bind(i, mediaIds[i], listingId)
      .run();
  }

  return json({ ok: true });
}

/**
 * DELETE /api/owner/media?id=<mediaId>&listingId=<listingId>
 *
 * Remove a photo or video from a listing. R2 objects are also deleted.
 */
export async function DELETE(context: APIContext) {
  const params = new URL(context.request.url).searchParams;
  const id = params.get('id') ?? '';
  const listingId = params.get('listingId') ?? '';

  if (!id || !listingId) return json({ error: 'id and listingId are required.' }, 400);

  const owned = await ownedListingId(context, listingId);
  if (owned instanceof Response) return owned;

  const db = getDb();
  const row = await db
    .prepare(
      'SELECT id, provider, external_id FROM media WHERE id = ? AND listing_id = ?'
    )
    .bind(id, listingId)
    .first<{ id: string; provider: string; external_id: string }>();
  if (!row) return json({ error: 'Media not found.' }, 404);

  // If it's an R2-hosted file, delete the object too
  if (row.provider === 'r2') {
    await deleteObject(row.external_id);
  }

  await db.prepare('DELETE FROM media WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
