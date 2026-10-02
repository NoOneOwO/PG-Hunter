/**
 * PG Hunter — Phase 3A server helpers for engagement.
 * Source of truth:
 *   pg_engagement_events = immutable-ish log (VIEW/SAVE/UNSAVE/LIKE/DISLIKE/UNLIKE/UNDISLIKE/ENQUIRY/SHARE)
 *   pg_reactions         = current reaction state (UNIQUE listing+user)
 *   saved_pgs            = current wishlist state (UNIQUE user+property, existing)
 *   pg_experiences       = moderated student experiences (pending by default)
 *   listing_events       = legacy owner analytics (kept, not source for new stats)
 * listing_id is TEXT without FK to allow mock IDs (prop_*) and D1 UUIDs. Do NOT create a second truth.
 */

import { getDb, nowIso } from './auth';
import type { UserRow } from './auth';

export type EngagementEventType =
  | 'VIEW'
  | 'SAVE'
  | 'UNSAVE'
  | 'LIKE'
  | 'DISLIKE'
  | 'UNLIKE'
  | 'UNDISLIKE'
  | 'ENQUIRY'
  | 'SHARE';

const VALID_EVENT_TYPES = new Set<string>([
  'VIEW',
  'SAVE',
  'UNSAVE',
  'LIKE',
  'DISLIKE',
  'UNLIKE',
  'UNDISLIKE',
  'ENQUIRY',
  'SHARE',
]);

export const isValidListingId = (id: string): boolean => {
  const t = id.trim();
  return t.length >= 3 && t.length <= 120 && /^[a-zA-Z0-9_-]+$/.test(t);
};

export const recordEvent = async (
  db: D1Database,
  listingId: string,
  userId: string | null,
  eventType: EngagementEventType,
  sessionId: string | null
): Promise<void> => {
  if (!VALID_EVENT_TYPES.has(eventType)) return;
  await db
    .prepare(
      'INSERT INTO pg_engagement_events (listing_id, user_id, event_type, session_id, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(listingId, userId, eventType, sessionId, nowIso())
    .run();
};

/** Record a VIEW with 5-minute dedup per user or anonymous session. Returns true if counted. */
export const recordView = async (
  db: D1Database,
  listingId: string,
  userId: string | null,
  sessionId: string | null
): Promise<boolean> => {
  // Deduplicate: same listing + same actor (user_id or session_id) within last 5 minutes
  const windowStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  let dup: { id: number } | null = null;
  if (userId) {
    dup = await db
      .prepare(
        `SELECT id FROM pg_engagement_events WHERE listing_id = ? AND event_type = 'VIEW' AND user_id = ? AND created_at > ? LIMIT 1`
      )
      .bind(listingId, userId, windowStart)
      .first<{ id: number }>();
  } else if (sessionId) {
    dup = await db
      .prepare(
        `SELECT id FROM pg_engagement_events WHERE listing_id = ? AND event_type = 'VIEW' AND session_id = ? AND user_id IS NULL AND created_at > ? LIMIT 1`
      )
      .bind(listingId, sessionId, windowStart)
      .first<{ id: number }>();
  } else {
    // No identity at all — still count but rate-limit by listing+type window globally? For now allow one per 1 minute globally by listing
    dup = await db
      .prepare(
        `SELECT id FROM pg_engagement_events WHERE listing_id = ? AND event_type = 'VIEW' AND user_id IS NULL AND session_id IS NULL AND created_at > ? LIMIT 1`
      )
      .bind(listingId, new Date(Date.now() - 60 * 1000).toISOString())
      .first<{ id: number }>();
  }
  if (dup) return false;
  await recordEvent(db, listingId, userId, 'VIEW', sessionId);
  return true;
};

export interface EngagementStats {
  views: number;
  saves: number;
  likes: number;
  dislikes: number;
  userSaved: boolean;
  userReaction: 'like' | 'dislike' | null;
}

export const getEngagementStats = async (
  db: D1Database,
  listingId: string,
  userId: string | null
): Promise<EngagementStats> => {
  const [viewsRow, savesRow, reactionsRes, userSavedRow, userReactionRow] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) as c FROM pg_engagement_events WHERE listing_id = ? AND event_type = 'VIEW'`)
      .bind(listingId)
      .first<{ c: number }>(),
    db.prepare(`SELECT COUNT(*) as c FROM saved_pgs WHERE property_id = ?`).bind(listingId).first<{ c: number }>(),
    db
      .prepare(`SELECT reaction, COUNT(*) as c FROM pg_reactions WHERE listing_id = ? GROUP BY reaction`)
      .bind(listingId)
      .all<{ reaction: string; c: number }>(),
    userId
      ? db
          .prepare(`SELECT 1 as x FROM saved_pgs WHERE property_id = ? AND user_id = ? LIMIT 1`)
          .bind(listingId, userId)
          .first<{ x: number }>()
      : Promise.resolve(null as any),
    userId
      ? db
          .prepare(`SELECT reaction FROM pg_reactions WHERE listing_id = ? AND user_id = ? LIMIT 1`)
          .bind(listingId, userId)
          .first<{ reaction: string }>()
      : Promise.resolve(null as any),
  ]);

  const likes = reactionsRes.results.find((r) => r.reaction === 'like')?.c ?? 0;
  const dislikes = reactionsRes.results.find((r) => r.reaction === 'dislike')?.c ?? 0;

  return {
    views: viewsRow?.c ?? 0,
    saves: savesRow?.c ?? 0,
    likes,
    dislikes,
    userSaved: Boolean(userSavedRow),
    userReaction: (userReactionRow?.reaction as 'like' | 'dislike' | null) ?? null,
  };
};

// Experiences
export interface ExperienceRow {
  id: string;
  listing_id: string;
  user_id: string;
  rating: number | null;
  content: string;
  status: 'pending' | 'approved' | 'rejected' | 'spam';
  created_at: string;
  updated_at: string;
  user_name?: string;
}

export const createExperience = async (
  db: D1Database,
  listingId: string,
  user: UserRow,
  rating: number | null,
  content: string
): Promise<ExperienceRow> => {
  const id = crypto.randomUUID();
  const now = nowIso();
  const cleanRating = rating !== null && rating >= 1 && rating <= 5 ? rating : null;
  const cleanContent = content.trim();
  await db
    .prepare(
      `INSERT INTO pg_experiences (id, listing_id, user_id, rating, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
    .bind(id, listingId, user.id, cleanRating, cleanContent, now, now)
    .run();
  // Also log an event for analytics (optional, not counted as VIEW)
  await recordEvent(db, listingId, user.id, 'ENQUIRY', null).catch(() => {});
  return {
    id,
    listing_id: listingId,
    user_id: user.id,
    rating: cleanRating,
    content: cleanContent,
    status: 'pending',
    created_at: now,
    updated_at: now,
  };
};

export const getApprovedExperiences = async (
  db: D1Database,
  listingId: string
): Promise<{ experiences: ExperienceRow[]; count: number; avgRating: number | null }> => {
  const res = await db
    .prepare(
      `SELECT e.id, e.listing_id, e.user_id, e.rating, e.content, e.status, e.created_at, e.updated_at, u.name as user_name
       FROM pg_experiences e
       LEFT JOIN users u ON u.id = e.user_id
       WHERE e.listing_id = ? AND e.status = 'approved'
       ORDER BY e.created_at DESC
       LIMIT 50`
    )
    .bind(listingId)
    .all<ExperienceRow & { user_name: string }>();

  const experiences = res.results.map((r) => ({
    id: r.id,
    listing_id: r.listing_id,
    user_id: r.user_id,
    rating: r.rating,
    content: r.content,
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at,
    user_name: r.user_name ?? 'Student',
  }));

  const count = experiences.length;
  const rated = experiences.filter((e) => e.rating !== null) as { rating: number }[];
  const avgRating = rated.length ? Number((rated.reduce((a, b) => a + b.rating, 0) / rated.length).toFixed(1)) : null;

  return { experiences, count, avgRating };
};

export const getDbForEngagement = () => getDb();
