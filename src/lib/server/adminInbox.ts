/**
 * PG Hunter — admin inbox reads (server-only).
 *
 * Builds the admin notification feed from the REAL queue tables. There is no
 * notifications table to write invented rows into: every item here corresponds
 * to a row a user actually created (a pending listing, an uploaded document, a
 * submitted creator assignment, ...). The only stored state is each admin's
 * "last seen" watermark (migration 0012).
 *
 * Every query is guarded: a missing table degrades to an empty source rather
 * than breaking the admin shell.
 */

import { nowIso } from './auth';
import { pendingPaymentsForInbox } from './payments';
import {
  INBOX_EPOCH,
  summariseInbox,
  type AdminInbox,
  type AdminInboxItem,
} from '../adminInbox';

export { INBOX_EPOCH };
export type { AdminInbox, AdminInboxItem };

type Rows<T> = { results: T[] };
const NONE = { results: [] } as Rows<any>;

export const getInboxItems = async (db: D1Database): Promise<AdminInboxItem[]> => {
  const [listings, verifs, exps, reports, apps, submissions, payments] = await Promise.all([
    db
      .prepare(
        "SELECT id, name, created_at FROM owner_listings WHERE status = 'pending' ORDER BY created_at DESC LIMIT 8"
      )
      .all<{ id: string; name: string | null; created_at: string }>()
      .catch(() => NONE),
    db
      .prepare(
        "SELECT id, doc_type, created_at FROM verification_documents WHERE status = 'pending' ORDER BY created_at DESC LIMIT 8"
      )
      .all<{ id: string; doc_type: string | null; created_at: string }>()
      .catch(() => NONE),
    db
      .prepare(
        "SELECT id, content, created_at FROM pg_experiences WHERE status = 'pending' ORDER BY created_at DESC LIMIT 8"
      )
      .all<{ id: string; content: string | null; created_at: string }>()
      .catch(() => NONE),
    db
      .prepare(
        "SELECT id, target_type, reason, created_at FROM reports WHERE status = 'open' ORDER BY created_at DESC LIMIT 8"
      )
      .all<{ id: string; target_type: string | null; reason: string | null; created_at: string }>()
      .catch(() => NONE),
    db
      .prepare(
        "SELECT id, full_name, created_at FROM creator_profiles WHERE status = 'pending' ORDER BY created_at DESC LIMIT 8"
      )
      .all<{ id: string; full_name: string | null; created_at: string }>()
      .catch(() => NONE),
    db
      .prepare(
        `SELECT id, title, pg_name, COALESCE(submitted_at, updated_at) AS at
           FROM creator_assignments
          WHERE status = 'submitted'
          ORDER BY COALESCE(submitted_at, updated_at) DESC LIMIT 8`
      )
      .all<{ id: string; title: string | null; pg_name: string | null; at: string }>()
      .catch(() => NONE),
    pendingPaymentsForInbox(db),
  ]);

  const items: AdminInboxItem[] = [
    ...listings.results.map((r) => ({
      id: `listing:${r.id}`,
      kind: 'listing' as const,
      title: 'Listing awaiting approval',
      detail: r.name || 'Untitled listing',
      href: '/admin/pgs?status=pending',
      at: r.created_at,
    })),
    ...verifs.results.map((r) => ({
      id: `verification:${r.id}`,
      kind: 'verification' as const,
      title: 'Verification document to review',
      detail: r.doc_type || 'Document',
      href: '/admin/verification',
      at: r.created_at,
    })),
    ...exps.results.map((r) => ({
      id: `experience:${r.id}`,
      kind: 'experience' as const,
      title: 'Experience awaiting moderation',
      detail: (r.content || '').slice(0, 70) || 'New experience',
      href: '/admin/experiences',
      at: r.created_at,
    })),
    ...reports.results.map((r) => ({
      id: `report:${r.id}`,
      kind: 'report' as const,
      title: 'Open report',
      detail: [r.target_type, r.reason].filter(Boolean).join(' · ') || 'Report',
      href: '/admin/reports',
      at: r.created_at,
    })),
    ...apps.results.map((r) => ({
      id: `creator_application:${r.id}`,
      kind: 'creator_application' as const,
      title: 'Creator application',
      detail: r.full_name || 'Applicant',
      href: '/admin/creators',
      at: r.created_at,
    })),
    ...submissions.results.map((r) => ({
      id: `creator_submission:${r.id}`,
      kind: 'creator_submission' as const,
      title: 'Creator work submitted',
      detail: r.title || r.pg_name || 'Assignment',
      href: '/admin/creators',
      at: r.at,
    })),
    ...payments.map((r) => ({
      id: `payment:${r.id}`,
      kind: 'payment' as const,
      title: 'Plan payment awaiting confirmation',
      detail: [r.owner_name || 'Owner', r.plan_slug, `₹${r.amount_inr}`].filter(Boolean).join(' · '),
      href: '/admin/payments',
      at: r.submitted_at,
    })),
  ];

  return items;
};

/** The inbox for one admin, with an unread count since their watermark. */
export const getAdminInbox = async (db: D1Database, userId: string): Promise<AdminInbox> => {
  const seen = await db
    .prepare('SELECT last_seen_at FROM admin_inbox_state WHERE user_id = ?')
    .bind(userId)
    .first<{ last_seen_at: string }>()
    .catch(() => null);

  const items = await getInboxItems(db);
  return summariseInbox(items, seen?.last_seen_at ?? INBOX_EPOCH);
};

/** Advance one admin's watermark to now. */
export const markInboxSeen = async (db: D1Database, userId: string): Promise<string> => {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO admin_inbox_state (user_id, last_seen_at, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         updated_at   = excluded.updated_at`
    )
    .bind(userId, now, now)
    .run();
  return now;
};
