import type { APIContext } from 'astro';
import { currentUser, getDb, json, nowIso, readBody } from '@/lib/server/auth';
import { getEngagementStats, isValidListingId, recordEvent } from '@/lib/server/engagement';

export const prerender = false;

/** GET /api/reactions?listingId=... — public counts + caller's reaction. */
export async function GET(context: APIContext) {
  const url = new URL(context.request.url);
  const listingId = String(url.searchParams.get('listingId') ?? url.searchParams.get('listing_id') ?? '').trim();
  if (!isValidListingId(listingId)) return json({ error: 'Missing listingId.' }, 400);
  const user = await currentUser(context);
  const stats = await getEngagementStats(getDb(), listingId, user?.id ?? null);
  return json({ likes: stats.likes, dislikes: stats.dislikes, userReaction: stats.userReaction });
}

/** POST /api/reactions { listingId, reaction: 'like'|'dislike'|null } — login required, one row per user+listing. */
export async function POST(context: APIContext) {
  const user = await currentUser(context);
  if (!user) return json({ error: 'Not logged in.' }, 401);

  const body = await readBody(context);
  const listingId = String(body?.listingId ?? body?.listing_id ?? body?.propertyId ?? '').trim();
  const rawReaction = body?.reaction;
  const reaction = rawReaction === 'like' || rawReaction === 'dislike' ? rawReaction : rawReaction === null || rawReaction === 'none' || rawReaction === '' ? null : undefined;

  if (!isValidListingId(listingId)) return json({ error: 'Missing or invalid listingId.' }, 400);
  if (reaction === undefined) return json({ error: 'reaction must be like, dislike or null.' }, 400);

  const db = getDb();
  const existing = await db
    .prepare(`SELECT reaction FROM pg_reactions WHERE listing_id = ? AND user_id = ? LIMIT 1`)
    .bind(listingId, user.id)
    .first<{ reaction: string }>();

  let eventType: 'LIKE' | 'DISLIKE' | 'UNLIKE' | 'UNDISLIKE' | null = null;

  if (reaction === null) {
    if (!existing) {
      const stats0 = await getEngagementStats(db, listingId, user.id);
      return json({ likes: stats0.likes, dislikes: stats0.dislikes, userReaction: null });
    }
    await db.prepare(`DELETE FROM pg_reactions WHERE listing_id = ? AND user_id = ?`).bind(listingId, user.id).run();
    eventType = existing.reaction === 'like' ? 'UNLIKE' : 'UNDISLIKE';
  } else {
    if (existing?.reaction === reaction) {
      const stats0 = await getEngagementStats(db, listingId, user.id);
      return json({ likes: stats0.likes, dislikes: stats0.dislikes, userReaction: reaction });
    }
    const now = nowIso();
    if (existing) {
      await db
        .prepare(`UPDATE pg_reactions SET reaction = ?, updated_at = ? WHERE listing_id = ? AND user_id = ?`)
        .bind(reaction, now, listingId, user.id)
        .run();
      eventType = reaction === 'like' ? 'LIKE' : 'DISLIKE';
    } else {
      await db
        .prepare(`INSERT INTO pg_reactions (listing_id, user_id, reaction, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(listingId, user.id, reaction, now, now)
        .run();
      eventType = reaction === 'like' ? 'LIKE' : 'DISLIKE';
    }
  }

  if (eventType) await recordEvent(db, listingId, user.id, eventType, null).catch(() => {});

  const stats = await getEngagementStats(db, listingId, user.id);
  return json({ likes: stats.likes, dislikes: stats.dislikes, userReaction: stats.userReaction });
}
