/**
 * PG Hunter — plan catalogue: shared types and fallbacks.
 *
 * Prices live in the database (migration 0008, table `plans`) so a business
 * decision does not require a code change and a redeploy. This module holds the
 * shape, the read helpers, and the safe fallback used when the catalogue cannot
 * be read.
 *
 * On the fallback: prices must never be *invented*. The constants below are the
 * values that are currently live and seeded, so they are known-accurate, not
 * guesses. They exist because these pages render server-side and a failed query
 * should degrade to the correct price rather than a blank one — showing nothing,
 * or showing a made-up number, would both be worse.
 */

/** The plan identifiers already constrained on `owner_listings.plan`. */
export type PlanSlug = 'basic' | 'verified';

export const PLAN_SLUGS: readonly PlanSlug[] = ['basic', 'verified'];

export interface Plan {
  slug: PlanSlug;
  name: string;
  tagline: string | null;
  priceInr: number;
  hasTravelCharge: boolean;
  durationDays: number;
  durationLabel: string;
  features: string[];
  checkoutNote: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface PlanRow {
  slug: string;
  name: string;
  tagline: string | null;
  price_inr: number;
  has_travel_charge: number;
  duration_days: number;
  duration_label: string;
  features: string;
  checkout_note: string | null;
  is_active: number;
  sort_order: number;
}

const parseFeatures = (value: string | null): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

const isPlanSlug = (value: unknown): value is PlanSlug =>
  typeof value === 'string' && (PLAN_SLUGS as readonly string[]).includes(value);

export const planFromRow = (row: PlanRow): Plan | null => {
  if (!isPlanSlug(row.slug)) return null;
  return {
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    priceInr: Number.isFinite(row.price_inr) ? row.price_inr : 0,
    hasTravelCharge: row.has_travel_charge === 1,
    durationDays: row.duration_days,
    durationLabel: row.duration_label,
    features: parseFeatures(row.features),
    checkoutNote: row.checkout_note,
    isActive: row.is_active === 1,
    sortOrder: row.sort_order,
  };
};

/**
 * Last-resort catalogue, used only when the `plans` table cannot be read.
 * These mirror the seeded values exactly.
 */
export const FALLBACK_PLANS: readonly Plan[] = [
  {
    slug: 'basic',
    name: 'Basic Listing',
    tagline: 'List your PG and start receiving enquiries.',
    priceInr: 0,
    hasTravelCharge: false,
    durationDays: 15,
    durationLabel: '15 days',
    features: [
      'Live listing for 15 days',
      'Receive student enquiries',
      'Upload your own photos',
      'Unverified badge',
    ],
    checkoutNote: null,
    isActive: true,
    sortOrder: 1,
  },
  {
    slug: 'verified',
    name: 'PG Hunter Verified',
    tagline: 'A real team visits your PG and verifies it on camera.',
    priceInr: 1499,
    hasTravelCharge: true,
    durationDays: 365,
    durationLabel: '1 year',
    features: [
      'PG Hunter Verified badge for 1 year',
      'Physical visit + photography',
      'Video walkthrough on your listing',
      '7–10 day visit window',
    ],
    checkoutNote:
      "We aim to complete your visit within 7–10 days of payment. If we're unable to schedule a visit within that window, we'll refund the verification fee in full.",
    isActive: true,
    sortOrder: 2,
  },
];

/**
 * Keep only active plans, de-duplicated by slug, in display order.
 *
 * De-duplication matters: if two rows ever claim the same slug the authoritative
 * price would otherwise depend on row order, which is the kind of ambiguity that
 * turns into a pricing incident.
 */
export const normalisePlans = (plans: Plan[]): Plan[] => {
  const seen = new Set<string>();
  return plans
    .filter((p) => p.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((p) => (seen.has(p.slug) ? false : (seen.add(p.slug), true)));
};

/** Look a plan up by slug, falling back to the known-good default. */
export const resolvePlan = (plans: Plan[], slug: PlanSlug): Plan =>
  plans.find((p) => p.slug === slug) ??
  (FALLBACK_PLANS.find((p) => p.slug === slug) as Plan);
