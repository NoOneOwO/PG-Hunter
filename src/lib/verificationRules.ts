/**
 * PG Hunter — pure plan and verification policy.
 *
 * Deliberately free of `cloudflare:workers`, `astro:*` and any project import,
 * so the rules that decide whether a listing is public and whether a badge is
 * live can be unit tested under plain Node with no bindings and no database.
 *
 * The stateful halves live next door:
 *   src/lib/server/listingPlans.ts    writes publication windows
 *   src/lib/server/verification.ts    writes the verification ledger
 */

export type ListingPlan = 'basic' | 'verified';

export const LISTING_PLANS: readonly ListingPlan[] = ['basic', 'verified'];

/**
 * Publication windows, in days: Basic 14, Verified 365 (product rule).
 */
export const PLAN_WINDOW_DAYS: Record<ListingPlan, number> = {
  basic: 14,
  verified: 365,
};

/**
 * Days for a plan value read back from the database.
 *
 * Unknown or missing values fall back to the SHORTER window. A data gap must
 * never hand out a free year of publication.
 */
export const planWindowDays = (plan: string | null | undefined): number =>
  PLAN_WINDOW_DAYS[plan === 'verified' ? 'verified' : 'basic'];

/** True when the value is one of the two plans this build understands. */
export const isListingPlan = (value: unknown): value is ListingPlan =>
  typeof value === 'string' && (LISTING_PLANS as readonly string[]).includes(value);

export const addDays = (iso: string, days: number): string =>
  new Date(new Date(iso).getTime() + days * 24 * 60 * 60 * 1000).toISOString();

/**
 * Has the publication window elapsed?
 *
 * A missing window means "no expiry recorded", not "expired". Legacy rows that
 * predate the plan columns must not disappear from the site.
 */
export const isExpired = (row: { expires_at: string | null }, now: number = Date.now()): boolean =>
  Boolean(row.expires_at) && Date.parse(row.expires_at as string) <= now;

export type VerificationTier = 'pg_hunter_verified' | 'rishabh_irl_verified';
export type VerificationMethod = 'document_review' | 'video_review' | 'physical_visit';

export const VERIFICATION_TIERS: readonly VerificationTier[] = [
  'pg_hunter_verified',
  'rishabh_irl_verified',
];

export const VERIFICATION_METHODS: readonly VerificationMethod[] = [
  'document_review',
  'video_review',
  'physical_visit',
];

export const VERIFICATION_TIER_LABELS: Record<VerificationTier, string> = {
  pg_hunter_verified: 'PG Hunter Verified',
  rishabh_irl_verified: 'Rishabh IRL Verified',
};

/**
 * How long a granted claim holds before it must be re-established.
 *
 * These are review windows, NOT priced subscription terms. The ₹1,499 /
 * 365-day Verified package is a plan window (`PLAN_WINDOW_DAYS`) tracked
 * separately. Do not couple the two: a paid plan expiring must not silently
 * extend or shorten a verification claim.
 */
export const VERIFICATION_WINDOW_DAYS: Record<VerificationTier, number> = {
  pg_hunter_verified: 365,
  rishabh_irl_verified: 180,
};

export interface VerificationCacheRow {
  verification_status: string | null;
  verification_expires_at: string | null;
}

/**
 * Does the listing currently hold a live claim?
 *
 * Reads the denormalised cache, which only `server/verification.ts` writes.
 * Both revocation and expiry clear it, and an absent expiry is treated as
 * "cannot be reasoned about" rather than "forever" — so a badge can never
 * outlive the evidence behind it.
 */
export const hasLiveVerification = (
  row: VerificationCacheRow,
  now: number = Date.now()
): boolean => {
  if (!row.verification_status || row.verification_status === 'unverified') return false;
  if (!row.verification_expires_at) return false;
  return Date.parse(row.verification_expires_at) > now;
};

/** Public label for a live claim, or null when there is nothing truthful to show. */
export const publicVerificationLabel = (
  row: VerificationCacheRow,
  now: number = Date.now()
): string | null => {
  if (!hasLiveVerification(row, now)) return null;
  const tier = row.verification_status as VerificationTier;
  return VERIFICATION_TIER_LABELS[tier] ?? null;
};

/**
 * Effective verification status for a response, downgrading a lapsed claim.
 * Used by the listing serializer so no response can advertise a dead badge.
 */
export const effectiveVerificationStatus = (
  row: VerificationCacheRow,
  now: number = Date.now()
): 'unverified' | VerificationTier => {
  if (!hasLiveVerification(row, now)) return 'unverified';
  return row.verification_status as VerificationTier;
};
