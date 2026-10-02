import type { APIContext } from 'astro';
import { getDb, json, nowIso, readBody, requireAdmin } from '@/lib/server/auth';

export const prerender = false;

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

interface TourRow {
  id: string;
  listing_id: string | null;
  external_id: string;
  title: string;
  sort_order: number;
  created_at: string;
  listing_name: string | null;
}

/**
 * Admin room-tour videos. Videos are YouTube ids for the MVP (see
 * /ai/MASTER_ARCHITECTURE.md — raw video uploads need Cloudflare Stream,
 * which is deferred). They show up on the owner's listing page via the
 * listing's media list.
 */
export async function GET(context: APIContext) {
  const admin = await requireAdmin(context);
  if ('error' in admin) return admin.error;

  const res = await getDb()
    .prepare(
      `SELECT m.id, m.listing_id, m.external_id, m.title, m.sort_order, m.created_at,
              ol.name AS listing_name
       FROM media m
       LEFT JOIN owner_listings ol ON ol.id = m.listing_id
       WHERE m.type = 'video'
       ORDER BY m.created_at DESC`
    )
    .all<TourRow>();

  return json({
    tours: res.results.map((t) => ({
      id: t.id,
      listingId: t.listing_id,
      listingName: t.listing_name,
      videoId: t.external_id,
      title: t.title,
      createdAt: t.created_at,
    })),
  });
}

export async function POST(context: APIContext) {
  const admin = await requireAdmin(context);
  if ('error' in admin) return admin.error;

  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const listingId = String(body.listingId ?? '').trim();
  const videoId = String(body.videoId ?? '').trim();
  const title = String(body.title ?? '').trim() || 'Room tour';

  if (!listingId) return json({ error: 'listingId is required.' }, 400);
  if (!YOUTUBE_ID_RE.test(videoId)) {
    return json({ error: 'videoId must be a valid YouTube video id.' }, 400);
  }

  const db = getDb();
  const listing = await db
    .prepare('SELECT id FROM owner_listings WHERE id = ?')
    .bind(listingId)
    .first<{ id: string }>();
  if (!listing) return json({ error: 'Listing not found.' }, 404);

  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO media (id, listing_id, type, provider, external_id, title, sort_order, uploaded_by, created_at) VALUES (?, ?, 'video', 'youtube', ?, ?, 0, ?, ?)"
    )
    .bind(id, listingId, videoId, title, admin.user.id, nowIso())
    .run();

  return json(
    {
      tour: {
        id,
        listingId,
        videoId,
        title,
        createdAt: nowIso(),
      },
    },
    201
  );
}
