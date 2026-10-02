/**
 * PG Hunter — verification service.
 *
 * Verification and publication are separate concerns and must never be
 * conflated (/ai/TRUTH_POLICY.md, /ai/SECURITY_RULEBOOK.md):
 *
 *   moderation status   owner_listings.status              draft|pending|active|rejected
 *   verification status owner_listings.verification_status  unverified|<tier>
 *
 * Publishing a listing (status = 'active') does NOT make it verified. The only
 * way `verification_status` may leave 'unverified' is through
 * `grantVerification()` below, which writes an auditable row into
 * `listing_verifications` (db/migrations/0006) demanding a named reviewer, a
 * method, and non-empty evidence.
 *
 * Direction of truth:
 *   listing_verifications  = source of truth + audit trail (append/revoke only)
 *   owner_listings.*       = read cache of the newest approved row, written
 *                            ONLY by the two functions in this module
 *
 * Revocation is a status change on the ledger row, never a DELETE, so the
 * history of what was claimed, by whom, and on what evidence survives.
 */

import { nowIso } from './auth';
// Tier/method vocabularies and the "is this claim live" rules are pure policy
// and live in src/lib/verificationRules.ts so they are unit-testable. Re-exported
// here so existing call sites keep a single import site.
import {
  VERIFICATION_METHODS,
  VERIFICATION_TIERS,
  VERIFICATION_TIER_LABELS,
  VERIFICATION_WINDOW_DAYS,
  addDays,
  hasLiveVerification,
  publicVerificationLabel,
  type VerificationMethod,
  type VerificationTier,
} from '../verificationRules';

export {
  VERIFICATION_METHODS,
  VERIFICATION_TIERS,
  VERIFICATION_TIER_LABELS,
  VERIFICATION_WINDOW_DAYS,
  hasLiveVerification,
  publicVerificationLabel,
};
export type { VerificationMethod, VerificationTier };

/** Reviewer identity is always a real admin user id, never a display string. */
export interface Reviewer {
  id: string;
}

/** Fields a caller may supply; everything else is derived server-side. */
export interface GrantVerificationInput {
  listingId: string;
  tier: VerificationTier;
  method: VerificationMethod;
  /** What backs the claim. Required and must be meaningful — see below. */
  evidence: string;
  /** Public-facing extra context for the confirm step. Optional. */
  note?: string | null;
  /** Override the default review window. Optional. */
  expiresAt?: string | null;
  reviewer: Reviewer;
}

export interface GrantVerificationResult {
  verificationId: string;
  tier: VerificationTier;
  expiresAt: string;
  verifiedAt: string;
  verifiedBy: string;
  method: VerificationMethod;
  evidence: string;
  /** How many previously-approved rows this grant superseded. */
  superseded: number;
}

export interface RevokeVerificationResult {
  revoked: number;
}

/**
 * Reasonable upper bound. The evidence string is an auditable reference
 * ("physical visit 2026-09-14, photos uploaded, owner ID sighted"), not a
 * dumping ground, and it is echoed back in admin responses.
 */
const MAX_EVIDENCE_LENGTH = 2000;

/**
 * Row-count from a D1 write.
 *
 * `meta.changes` is typed loosely upstream (number | object), so narrow it
 * here rather than sprinkling casts through the callers.
 */
const changedRows = (result: { meta?: { changes?: unknown } }): number => {
  const changes = result.meta?.changes;
  return typeof changes === 'number' ? changes : 0;
};

/**
 * Grant a verification tier to a listing.
 *
 * Writes the ledger row and then refreshes the denormalised read cache on
 * `owner_listings`. Any earlier approved row is revoked first so that the
 * cache and the ledger cannot disagree, and so re-verification leaves a
 * visible trail instead of silently overwriting history.
 *
 * The caller MUST be an authorised admin — this function does no
 * authorisation of its own; every route that reaches it goes through
 * `requireAdmin()` first.
 */
export const grantVerification = async (
  db: D1Database,
  input: GrantVerificationInput
): Promise<GrantVerificationResult> => {
  const evidence = String(input.evidence ?? '').trim();
  if (!evidence) {
    throw new Error('Verification evidence is required — a badge cannot be granted on a bare click.');
  }
  if (evidence.length > MAX_EVIDENCE_LENGTH) {
    throw new Error(`Verification evidence must be ${MAX_EVIDENCE_LENGTH} characters or fewer.`);
  }
  if (!VERIFICATION_TIERS.includes(input.tier)) {
    throw new Error(`Unknown verification tier: ${input.tier}`);
  }
  if (!VERIFICATION_METHODS.includes(input.method)) {
    throw new Error(`Unknown verification method: ${input.method}`);
  }

  const listing = await db
    .prepare('SELECT id FROM owner_listings WHERE id = ?')
    .bind(input.listingId)
    .first<{ id: string }>();
  if (!listing) throw new Error('Listing not found.');

  const verifiedAt = nowIso();
  const expiresAt =
    input.expiresAt && !Number.isNaN(Date.parse(input.expiresAt))
      ? new Date(input.expiresAt).toISOString()
      : addDays(verifiedAt, VERIFICATION_WINDOW_DAYS[input.tier]);

  // Supersede any currently-approved row for this listing.
  const replaced = await db
    .prepare(
      `UPDATE listing_verifications
          SET status = 'revoked',
              revoked_at = ?,
              revoked_by = ?,
              revoke_reason = ?
        WHERE listing_id = ? AND status = 'approved'`
    )
    .bind(
      verifiedAt,
      input.reviewer.id,
      `Superseded by a new ${input.tier} verification on ${verifiedAt}`,
      input.listingId
    )
    .run();

  const verificationId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO listing_verifications
         (id, listing_id, tier, status, method, evidence, note,
          verified_by, verified_at, expires_at)
       VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      verificationId,
      input.listingId,
      input.tier,
      input.method,
      evidence,
      input.note ? String(input.note).trim().slice(0, 1000) : null,
      input.reviewer.id,
      verifiedAt,
      expiresAt
    )
    .run();

  // Refresh the read cache. These columns exist for cheap reads on the public
  // listing queries; nothing else in the codebase may write them.
  await db
    .prepare(
      `UPDATE owner_listings
          SET verification_status = ?,
              verified_at = ?,
              verified_by = ?,
              verification_method = ?,
              verification_evidence = ?,
              verification_expires_at = ?,
              updated_at = ?
        WHERE id = ?`
    )
    .bind(
      input.tier,
      verifiedAt,
      input.reviewer.id,
      input.method,
      evidence,
      expiresAt,
      verifiedAt,
      input.listingId
    )
    .run();

  return {
    verificationId,
    tier: input.tier,
    expiresAt,
    verifiedAt,
    verifiedBy: input.reviewer.id,
    method: input.method,
    evidence,
    superseded: changedRows(replaced),
  };
};

/**
 * Revoke the active verification on a listing.
 *
 * Two things happen, and the second is the important one:
 *   1. The ledger row is marked revoked (kept, never deleted) with a reason
 *      and the reviewer who made the call.
 *   2. The listing is returned to 'pending' and pulled from public results.
 *
 * Step 2 is deliberate. Revocation happens when the verification was wrong —
 * forged documents, a failed re-inspection, a fraud report upheld. Leaving
 * such a listing published would keep showing the world a property whose
 * trust claim we just withdrew, so it goes back through moderation instead.
 * Re-approval restores publication but NOT the badge.
 */
export const revokeVerification = async (
  db: D1Database,
  options: { listingId: string; reason: string; reviewer: Reviewer }
): Promise<RevokeVerificationResult> => {
  const reason = String(options.reason ?? '').trim();
  if (!reason) throw new Error('A revocation reason is required.');
  if (reason.length > MAX_EVIDENCE_LENGTH) {
    throw new Error(`Revocation reason must be ${MAX_EVIDENCE_LENGTH} characters or fewer.`);
  }

  const listing = await db
    .prepare('SELECT id FROM owner_listings WHERE id = ?')
    .bind(options.listingId)
    .first<{ id: string }>();
  if (!listing) throw new Error('Listing not found.');

  const revokedAt = nowIso();
  const result = await db
    .prepare(
      `UPDATE listing_verifications
          SET status = 'revoked',
              revoked_at = ?,
              revoked_by = ?,
              revoke_reason = ?
        WHERE listing_id = ? AND status = 'approved'`
    )
    .bind(revokedAt, options.reviewer.id, reason, options.listingId)
    .run();

  await db
    .prepare(
      `UPDATE owner_listings
          SET verification_status = 'unverified',
              verified_at = NULL,
              verified_by = NULL,
              verification_method = NULL,
              verification_evidence = NULL,
              verification_expires_at = NULL,
              status = CASE WHEN status = 'active' THEN 'pending' ELSE status END,
              expires_at = CASE WHEN status = 'active' THEN NULL ELSE expires_at END,
              updated_at = ?
        WHERE id = ?`
    )
    .bind(revokedAt, options.listingId)
    .run();

  return { revoked: changedRows(result) };
};

// `hasLiveVerification` and `publicVerificationLabel` are re-exported above from
// src/lib/verificationRules.ts. Keep the policy there, not here.
