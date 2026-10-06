/**
 * PG Hunter — Creator programme server logic (Worker only).
 *
 * Owns every D1 read/write for the creator funnel. The decisions themselves
 * (validation, referral-code shape, earnings arithmetic, status metadata) live
 * in src/lib/creatorRules.ts so they are testable under plain Node; this module
 * is the thin, binding-aware layer around them.
 *
 * Rules this module enforces, because the UI alone cannot:
 *   - one profile per user (`creator_profiles.user_id` is UNIQUE), so "register
 *     as a creator" can never create duplicates;
 *   - resubmitting a rejected application returns it to `pending` and clears
 *     the old decision, so it re-enters the queue honestly;
 *   - a referral is only recorded for an approved creator, never for yourself,
 *     and never twice for the same referred account;
 *   - money is only ever summed from assignment rows (see earningsSummary).
 */

import { nowIso, randomHex, type UserRow } from './auth';
import {
  buildReferralCode,
  creatorProfileGaps,
  earningsSummary,
  isAssignmentStatus,
  isCreatorStatus,
  normalizeReferralCode,
  type AssignmentStatus,
  type CleanCreatorApplication,
  type CreatorSkill,
  type CreatorStatus,
  type EarningsSummary,
} from '../creatorRules';

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

export interface CreatorProfileRow {
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  city: string;
  areas: string;
  primary_skill: CreatorSkill;
  bio: string;
  portfolio_url: string | null;
  equipment: string | null;
  availability: string | null;
  payout_upi: string | null;
  referral_code: string;
  status: CreatorStatus;
  review_notes: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatorAssignmentRow {
  id: string;
  creator_id: string;
  title: string;
  pg_name: string;
  locality: string | null;
  city: string | null;
  brief: string | null;
  payout: number;
  status: AssignmentStatus;
  due_at: string | null;
  submission_note: string | null;
  submission_url: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  rejected_reason: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatorReferralRow {
  id: string;
  creator_id: string;
  referred_user_id: string | null;
  code: string;
  status: 'signed_up' | 'listed' | 'paid';
  note: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* Public shapes                                                       */
/* ------------------------------------------------------------------ */

export interface PublicCreator {
  id: string;
  userId: string;
  fullName: string;
  phone: string;
  city: string;
  areas: string[];
  primarySkill: CreatorSkill;
  bio: string;
  portfolioUrl: string | null;
  equipment: string | null;
  availability: string | null;
  payoutUpi: string | null;
  referralCode: string;
  status: CreatorStatus;
  reviewNotes: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Missing profile fields, so the dashboard can nudge without inventing data. */
  gaps: string[];
}

export interface PublicAssignment {
  id: string;
  title: string;
  pgName: string;
  locality: string | null;
  city: string | null;
  brief: string | null;
  payout: number;
  status: AssignmentStatus;
  dueAt: string | null;
  submissionNote: string | null;
  submissionUrl: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectedReason: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicReferral {
  id: string;
  status: 'signed_up' | 'listed' | 'paid';
  note: string | null;
  createdAt: string;
}

export interface CreatorActivityItem {
  id: string;
  kind: 'application' | 'decision' | 'assignment' | 'submission' | 'payout' | 'referral';
  title: string;
  detail: string;
  at: string;
}

export interface CreatorDashboard {
  profile: PublicCreator | null;
  assignments: PublicAssignment[];
  referrals: { total: number; converted: number; recent: PublicReferral[] };
  earnings: EarningsSummary;
  activity: CreatorActivityItem[];
}

const splitAreas = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 12);

export const publicCreator = (row: CreatorProfileRow): PublicCreator => ({
  id: row.id,
  userId: row.user_id,
  fullName: row.full_name,
  phone: row.phone,
  city: row.city,
  areas: splitAreas(row.areas),
  primarySkill: row.primary_skill,
  bio: row.bio,
  portfolioUrl: row.portfolio_url,
  equipment: row.equipment,
  availability: row.availability,
  payoutUpi: row.payout_upi,
  referralCode: row.referral_code,
  status: row.status,
  reviewNotes: row.review_notes,
  reviewedAt: row.reviewed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  gaps: creatorProfileGaps({
    fullName: row.full_name,
    phone: row.phone,
    city: row.city,
    bio: row.bio,
    payoutUpi: row.payout_upi,
  }),
});

export const publicAssignment = (row: CreatorAssignmentRow): PublicAssignment => ({
  id: row.id,
  title: row.title,
  pgName: row.pg_name,
  locality: row.locality,
  city: row.city,
  brief: row.brief,
  payout: Number(row.payout ?? 0),
  status: row.status,
  dueAt: row.due_at,
  submissionNote: row.submission_note,
  submissionUrl: row.submission_url,
  submittedAt: row.submitted_at,
  reviewedAt: row.reviewed_at,
  rejectedReason: row.rejected_reason,
  paidAt: row.paid_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const publicReferral = (row: CreatorReferralRow): PublicReferral => ({
  id: row.id,
  status: row.status,
  note: row.note,
  createdAt: row.created_at,
});

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export const getCreatorByUserId = async (
  db: D1Database,
  userId: string
): Promise<CreatorProfileRow | null> =>
  (await db.prepare('SELECT * FROM creator_profiles WHERE user_id = ?').bind(userId).first<CreatorProfileRow>()) ?? null;

export const getCreatorByReferralCode = async (
  db: D1Database,
  code: unknown
): Promise<CreatorProfileRow | null> => {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return null;
  return (
    (await db
      .prepare('SELECT * FROM creator_profiles WHERE referral_code = ?')
      .bind(normalized)
      .first<CreatorProfileRow>()) ?? null
  );
};

const assignmentsFor = async (db: D1Database, creatorId: string): Promise<PublicAssignment[]> => {
  const res = await db
    .prepare('SELECT * FROM creator_assignments WHERE creator_id = ? ORDER BY created_at DESC')
    .bind(creatorId)
    .all<CreatorAssignmentRow>();
  return (res.results ?? []).map(publicAssignment);
};

const referralsFor = async (db: D1Database, creatorId: string): Promise<PublicReferral[]> => {
  const res = await db
    .prepare('SELECT * FROM creator_referrals WHERE creator_id = ? ORDER BY created_at DESC')
    .bind(creatorId)
    .all<CreatorReferralRow>();
  return (res.results ?? []).map(publicReferral);
};

export const getCreatorDashboard = async (
  db: D1Database,
  user: UserRow
): Promise<CreatorDashboard> => {
  const row = await getCreatorByUserId(db, user.id);
  if (!row) {
    return {
      profile: null,
      assignments: [],
      referrals: { total: 0, converted: 0, recent: [] },
      earnings: earningsSummary([]),
      activity: [],
    };
  }

  const [assignments, referrals] = await Promise.all([
    assignmentsFor(db, user.id),
    referralsFor(db, user.id),
  ]);

  const earnings = earningsSummary(
    assignments.map((item) => ({ payout: item.payout, status: item.status, paidAt: item.paidAt }))
  );

  const activity: CreatorActivityItem[] = [
    {
      id: `app-${row.id}`,
      kind: 'application',
      title: 'Application submitted',
      detail: `${row.city} · ${row.primary_skill === 'both' ? 'Photo & video' : row.primary_skill}`,
      at: row.created_at,
    },
  ];

  if (row.reviewed_at) {
    activity.push({
      id: `review-${row.id}`,
      kind: 'decision',
      title: row.status === 'approved' ? 'Application approved' : 'Application reviewed',
      detail: row.status === 'approved' ? 'You can now be assigned PGs.' : 'See the reviewer note.',
      at: row.reviewed_at,
    });
  }

  for (const item of assignments) {
    activity.push({
      id: `assign-${item.id}`,
      kind: 'assignment',
      title: `Assignment: ${item.pgName || item.title}`,
      detail: item.locality ? `${item.locality}${item.city ? `, ${item.city}` : ''}` : 'Awaiting your visit',
      at: item.createdAt,
    });
    if (item.submittedAt) {
      activity.push({
        id: `submit-${item.id}`,
        kind: 'submission',
        title: `Submitted: ${item.pgName || item.title}`,
        detail: item.status === 'approved' ? 'Approved by review' : 'Awaiting review',
        at: item.submittedAt,
      });
    }
    if (item.paidAt) {
      activity.push({
        id: `paid-${item.id}`,
        kind: 'payout',
        title: `Payout marked paid`,
        detail: item.pgName || item.title,
        at: item.paidAt,
      });
    }
    if (item.reviewedAt && item.status === 'rejected') {
      activity.push({
        id: `rej-${item.id}`,
        kind: 'submission',
        title: `Sent back: ${item.pgName || item.title}`,
        detail: item.rejectedReason ?? 'See the reviewer note.',
        at: item.reviewedAt,
      });
    }
  }

  for (const referral of referrals) {
    activity.push({
      id: `ref-${referral.id}`,
      kind: 'referral',
      title: 'New owner through your link',
      detail: referral.note ?? 'Signed up with your creator code',
      at: referral.createdAt,
    });
  }

  activity.sort((a, b) => (a.at < b.at ? 1 : -1));

  return {
    profile: publicCreator(row),
    assignments,
    referrals: {
      total: referrals.length,
      converted: referrals.filter((item) => item.status !== 'signed_up').length,
      recent: referrals.slice(0, 5),
    },
    earnings,
    activity: activity.slice(0, 14),
  };
};

/* ------------------------------------------------------------------ */
/* Application upsert                                                  */
/* ------------------------------------------------------------------ */

/**
 * Allocate a referral code that is not taken yet. Six attempts against a
 * 16-bit suffix is plenty; a genuine failure is surfaced rather than guessed.
 */
const allocateReferralCode = async (db: D1Database, name: string): Promise<string> => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = buildReferralCode(name, randomHex(2));
    const clash = await db
      .prepare('SELECT id FROM creator_profiles WHERE referral_code = ?')
      .bind(code)
      .first();
    if (!clash) return code;
  }
  throw new Error('Could not allocate a creator code. Please try again.');
};

/**
 * Create the application, or update it.
 *
 * A rejected application that has been corrected goes back to `pending` with
 * its previous decision cleared — the review must be a fresh one, not a stale
 * approval attached to edited details.
 */
export const upsertCreatorApplication = async (
  db: D1Database,
  user: UserRow,
  value: CleanCreatorApplication
): Promise<CreatorProfileRow> => {
  const existing = await getCreatorByUserId(db, user.id);
  const now = nowIso();

  if (!existing) {
    const code = await allocateReferralCode(db, value.fullName || user.name);
    const row: CreatorProfileRow = {
      id: crypto.randomUUID(),
      user_id: user.id,
      full_name: value.fullName,
      phone: value.phone,
      city: value.city,
      areas: value.areas,
      primary_skill: value.primarySkill,
      bio: value.bio,
      portfolio_url: value.portfolioUrl,
      equipment: value.equipment,
      availability: value.availability,
      payout_upi: value.payoutUpi,
      referral_code: code,
      status: 'pending',
      review_notes: null,
      reviewed_at: null,
      reviewed_by: null,
      created_at: now,
      updated_at: now,
    };

    await db
      .prepare(
        `INSERT INTO creator_profiles
           (id, user_id, full_name, phone, city, areas, primary_skill, bio, portfolio_url,
            equipment, availability, payout_upi, referral_code, status, review_notes,
            reviewed_at, reviewed_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        row.id,
        row.user_id,
        row.full_name,
        row.phone,
        row.city,
        row.areas,
        row.primary_skill,
        row.bio,
        row.portfolio_url,
        row.equipment,
        row.availability,
        row.payout_upi,
        row.referral_code,
        row.status,
        row.review_notes,
        row.reviewed_at,
        row.reviewed_by,
        row.created_at,
        row.updated_at
      )
      .run();

    return row;
  }

  const resubmitting = existing.status === 'rejected';
  const status: CreatorStatus = resubmitting ? 'pending' : existing.status;

  await db
    .prepare(
      `UPDATE creator_profiles
         SET full_name = ?, phone = ?, city = ?, areas = ?, primary_skill = ?, bio = ?,
             portfolio_url = ?, equipment = ?, availability = ?, payout_upi = ?,
             status = ?, review_notes = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ?
       WHERE user_id = ?`
    )
    .bind(
      value.fullName,
      value.phone,
      value.city,
      value.areas,
      value.primarySkill,
      value.bio,
      value.portfolioUrl,
      value.equipment,
      value.availability,
      value.payoutUpi,
      status,
      resubmitting ? null : existing.review_notes,
      resubmitting ? null : existing.reviewed_at,
      resubmitting ? null : existing.reviewed_by,
      now,
      user.id
    )
    .run();

  return {
    ...existing,
    full_name: value.fullName,
    phone: value.phone,
    city: value.city,
    areas: value.areas,
    primary_skill: value.primarySkill,
    bio: value.bio,
    portfolio_url: value.portfolioUrl,
    equipment: value.equipment,
    availability: value.availability,
    payout_upi: value.payoutUpi,
    status,
    review_notes: resubmitting ? null : existing.review_notes,
    reviewed_at: resubmitting ? null : existing.reviewed_at,
    reviewed_by: resubmitting ? null : existing.reviewed_by,
    updated_at: now,
  };
};

/* ------------------------------------------------------------------ */
/* Referrals                                                           */
/* ------------------------------------------------------------------ */

/**
 * Record that `referredUserId` arrived through `code`.
 *
 * Only an approved creator earns a referral, self-referrals are ignored, and
 * the same account can only be claimed once — so the count on the dashboard is
 * a real count of distinct owners, not a counter anyone can inflate.
 */
export const recordCreatorReferral = async (
  db: D1Database,
  code: unknown,
  referredUser: UserRow,
  note?: string
): Promise<boolean> => {
  const profile = await getCreatorByReferralCode(db, code);
  if (!profile) return false;
  if (profile.status !== 'approved') return false;
  if (profile.user_id === referredUser.id) return false;

  const existing = await db
    .prepare('SELECT id FROM creator_referrals WHERE creator_id = ? AND referred_user_id = ?')
    .bind(profile.user_id, referredUser.id)
    .first();
  if (existing) return false;

  await db
    .prepare(
      `INSERT INTO creator_referrals (id, creator_id, referred_user_id, code, status, note, created_at)
       VALUES (?, ?, ?, ?, 'signed_up', ?, ?)`
    )
    .bind(crypto.randomUUID(), profile.user_id, referredUser.id, profile.referral_code, note ?? null, nowIso())
    .run();

  return true;
};

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export interface AdminCreatorRow extends CreatorProfileRow {
  user_name: string;
  user_email: string;
}

export interface AdminAssignmentRow extends CreatorAssignmentRow {
  creator_name: string;
  creator_email: string;
}

export const listCreators = async (
  db: D1Database,
  status?: string
): Promise<AdminCreatorRow[]> => {
  const filter = isCreatorStatus(status) ? 'WHERE cp.status = ?' : '';
  const res = await db
    .prepare(
      `SELECT cp.*, u.name AS user_name, u.email AS user_email
       FROM creator_profiles cp
       JOIN users u ON u.id = cp.user_id
       ${filter}
       ORDER BY CASE cp.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
                cp.created_at DESC
       LIMIT 200`
    )
    .bind(...(isCreatorStatus(status) ? [status] : []))
    .all<AdminCreatorRow>();
  return res.results ?? [];
};

export const countCreatorsByStatus = async (db: D1Database): Promise<Record<string, number>> => {
  const res = await db
    .prepare('SELECT status, COUNT(*) AS c FROM creator_profiles GROUP BY status')
    .all<{ status: string; c: number }>()
    .catch(() => ({ results: [] as { status: string; c: number }[] }));
  const counts: Record<string, number> = {};
  for (const row of res.results ?? []) counts[row.status] = row.c;
  return counts;
};

export const listCreatorAssignments = async (
  db: D1Database,
  limit = 100
): Promise<AdminAssignmentRow[]> => {
  const res = await db
    .prepare(
      `SELECT ca.*, u.name AS creator_name, u.email AS creator_email
       FROM creator_assignments ca
       JOIN users u ON u.id = ca.creator_id
       ORDER BY CASE ca.status
                  WHEN 'submitted' THEN 0
                  WHEN 'assigned' THEN 1
                  WHEN 'in_progress' THEN 2
                  ELSE 3 END,
                ca.created_at DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<AdminAssignmentRow>();
  return res.results ?? [];
};

/**
 * Decide an application. Approving is what unlocks assignments and referral
 * credit; the decision is recorded with who made it and when.
 */
export const reviewCreatorApplication = async (
  db: D1Database,
  creatorId: string,
  decision: 'approved' | 'rejected',
  adminId: string,
  notes?: string | null
): Promise<CreatorProfileRow | null> => {
  const now = nowIso();
  const result = await db
    .prepare(
      `UPDATE creator_profiles
         SET status = ?, review_notes = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(decision, notes?.slice(0, 500) ?? null, now, adminId, now, creatorId)
    .run();
  if ((result.meta?.changes ?? 0) === 0) return null;
  return (await db.prepare('SELECT * FROM creator_profiles WHERE id = ?').bind(creatorId).first<CreatorProfileRow>()) ?? null;
};

export const createCreatorAssignment = async (
  db: D1Database,
  input: {
    creatorId: string;
    title: string;
    pgName: string;
    locality?: string;
    city?: string;
    brief?: string;
    payout: number;
    dueAt?: string;
  }
): Promise<CreatorAssignmentRow> => {
  const now = nowIso();
  const row: CreatorAssignmentRow = {
    id: crypto.randomUUID(),
    creator_id: input.creatorId,
    title: input.title,
    pg_name: input.pgName,
    locality: input.locality ?? null,
    city: input.city ?? null,
    brief: input.brief ?? null,
    payout: Math.max(0, Math.round(input.payout)),
    status: 'assigned',
    due_at: input.dueAt ?? null,
    submission_note: null,
    submission_url: null,
    submitted_at: null,
    reviewed_at: null,
    rejected_reason: null,
    paid_at: null,
    created_at: now,
    updated_at: now,
  };

  await db
    .prepare(
      `INSERT INTO creator_assignments
         (id, creator_id, title, pg_name, locality, city, brief, payout, status, due_at,
          submission_note, submission_url, submitted_at, reviewed_at, rejected_reason,
          paid_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      row.id,
      row.creator_id,
      row.title,
      row.pg_name,
      row.locality,
      row.city,
      row.brief,
      row.payout,
      row.status,
      row.due_at,
      row.submission_note,
      row.submission_url,
      row.submitted_at,
      row.reviewed_at,
      row.rejected_reason,
      row.paid_at,
      row.created_at,
      row.updated_at
    )
    .run();

  return row;
};

/**
 * A creator moves their own assignment forward: start it, or submit it.
 * Both transitions are validated against the current status so a submitted
 * assignment cannot be re-submitted by replaying the request.
 */
export const advanceAssignment = async (
  db: D1Database,
  creatorId: string,
  assignmentId: string,
  action: 'start' | 'submit',
  payload: { note?: string; url?: string }
): Promise<CreatorAssignmentRow | null> => {
  const row = await db
    .prepare('SELECT * FROM creator_assignments WHERE id = ? AND creator_id = ?')
    .bind(assignmentId, creatorId)
    .first<CreatorAssignmentRow>();
  if (!row) return null;

  const now = nowIso();

  if (action === 'start') {
    if (row.status !== 'assigned') return row;
    await db
      .prepare(`UPDATE creator_assignments SET status = 'in_progress', updated_at = ? WHERE id = ?`)
      .bind(now, row.id)
      .run();
    return { ...row, status: 'in_progress', updated_at: now };
  }

  if (row.status !== 'in_progress' && row.status !== 'rejected') return row;

  await db
    .prepare(
      `UPDATE creator_assignments
         SET status = 'submitted', submission_note = ?, submission_url = ?, submitted_at = ?,
             reviewed_at = NULL, rejected_reason = NULL, updated_at = ?
       WHERE id = ?`
    )
    .bind(payload.note?.slice(0, 1000) ?? null, payload.url?.slice(0, 300) ?? null, now, now, row.id)
    .run();

  return {
    ...row,
    status: 'submitted',
    submission_note: payload.note?.slice(0, 1000) ?? null,
    submission_url: payload.url?.slice(0, 300) ?? null,
    submitted_at: now,
    reviewed_at: null,
    rejected_reason: null,
    updated_at: now,
  };
};

/**
 * Admin decision on a submitted assignment. Money is never invented here: the
 * payout comes from the assignment stored at assignment time, and `markPaid`
 * only stamps `paid_at` on an already-approved row.
 */
export const reviewCreatorAssignment = async (
  db: D1Database,
  assignmentId: string,
  decision: 'approved' | 'rejected' | 'paid',
  reason?: string | null
): Promise<CreatorAssignmentRow | null> => {
  const row = await db
    .prepare('SELECT * FROM creator_assignments WHERE id = ?')
    .bind(assignmentId)
    .first<CreatorAssignmentRow>();
  if (!row) return null;

  const now = nowIso();

  if (decision === 'paid') {
    if (row.status !== 'approved') return row;
    await db
      .prepare('UPDATE creator_assignments SET paid_at = ?, updated_at = ? WHERE id = ?')
      .bind(now, now, row.id)
      .run();
    return { ...row, paid_at: now, updated_at: now };
  }

  if (decision === 'rejected') {
    await db
      .prepare(
        `UPDATE creator_assignments
           SET status = 'rejected', rejected_reason = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(reason?.slice(0, 500) ?? null, now, now, row.id)
      .run();
    return { ...row, status: 'rejected', rejected_reason: reason?.slice(0, 500) ?? null, reviewed_at: now, updated_at: now };
  }

  if (row.status !== 'submitted') return row;
  await db
    .prepare(
      `UPDATE creator_assignments
         SET status = 'approved', reviewed_at = ?, rejected_reason = NULL, updated_at = ?
       WHERE id = ?`
    )
    .bind(now, now, row.id)
    .run();
  return { ...row, status: 'approved', reviewed_at: now, rejected_reason: null, updated_at: now };
};

/* ------------------------------------------------------------------ */
/* Input coercion for admin assignment creation                        */
/* ------------------------------------------------------------------ */

export interface AssignmentInput {
  creatorId: string;
  title: string;
  pgName: string;
  locality?: string;
  city?: string;
  brief?: string;
  payout: number;
  dueAt?: string;
}

export type AssignmentInputResult =
  | { ok: true; value: AssignmentInput }
  | { ok: false; error: string };

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const parseAssignmentInput = (body: Record<string, unknown>): AssignmentInputResult => {
  const creatorId = asText(body.creatorId);
  const title = asText(body.title);
  const pgName = asText(body.pgName);
  const payoutRaw = body.payout;

  if (!creatorId) return { ok: false, error: 'Pick a creator for this assignment.' };
  if (title.length < 3 || title.length > 120) {
    return { ok: false, error: 'Give the assignment a title of 3–120 characters.' };
  }
  if (!pgName) return { ok: false, error: 'Name the PG this assignment is for.' };

  const payout = typeof payoutRaw === 'number' ? payoutRaw : Number.parseInt(String(payoutRaw ?? ''), 10);
  if (!Number.isFinite(payout) || payout < 0 || payout > 500000) {
    return { ok: false, error: 'Payout must be a number between 0 and 5,00,000.' };
  }

  const dueRaw = asText(body.dueAt);
  if (dueRaw && !/^\d{4}-\d{2}-\d{2}$/.test(dueRaw)) {
    return { ok: false, error: 'Due date must be in YYYY-MM-DD format.' };
  }

  return {
    ok: true,
    value: {
      creatorId,
      title,
      pgName,
      locality: asText(body.locality) || undefined,
      city: asText(body.city) || undefined,
      brief: asText(body.brief) || undefined,
      payout,
      dueAt: dueRaw ? `${dueRaw}T23:59:59.000Z` : undefined,
    },
  };
};

/** Narrow an arbitrary string from a query param to a status filter. */
export const assignmentStatusFilter = (value: unknown): AssignmentStatus | null =>
  isAssignmentStatus(value) ? value : null;
