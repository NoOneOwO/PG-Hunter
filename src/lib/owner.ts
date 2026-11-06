/**
 * PG Hunter — owner frontend helpers: status metadata, labels and small
 * formatters used across the /owner/* pages. Mirrors the audit of the
 * Cloudflare owner APIs (see src/lib/auth.ts for the client types).
 */

import type { Listing } from '@/lib/auth';
import { formatINR } from '@/lib/format';

/* ------------------------------------------------------------------ */
/* Listing status                                                      */
/* ------------------------------------------------------------------ */

export type ListingStatus = Listing['status'];

export const listingStatusMeta: Record<
  ListingStatus,
  { label: string; classes: string; dot: string; hint: string }
> = {
  draft: {
    label: 'Draft',
    classes: 'bg-slate-100 text-slate-700',
    dot: 'bg-slate-400',
    hint: 'Saved but not submitted for review yet.',
  },
  pending: {
    label: 'Pending review',
    classes: 'bg-amber-100 text-amber-800',
    dot: 'bg-amber-500',
    hint: 'Submitted — our team is reviewing it.',
  },
  active: {
    label: 'Live',
    classes: 'bg-emerald-100 text-emerald-800',
    dot: 'bg-emerald-500',
    hint: 'Live for students to find and enquire.',
  },
  rejected: {
    label: 'Rejected',
    classes: 'bg-rose-100 text-rose-800',
    dot: 'bg-rose-500',
    hint: 'Needs changes before it can go live.',
  },
};

/* ------------------------------------------------------------------ */
/* Verification status                                                 */
/* ------------------------------------------------------------------ */

export type VerificationStatus = Listing['verificationStatus'];

export const verificationStatusMeta: Record<
  VerificationStatus,
  { label: string; classes: string }
> = {
  unverified: { label: 'Unverified', classes: 'bg-slate-100 text-slate-600' },
  pg_hunter_verified: { label: 'PG Hunter Verified', classes: 'bg-brand-100 text-brand-800' },
  rishabh_irl_verified: { label: 'Rishabh IRL Verified', classes: 'bg-emerald-100 text-emerald-800' },
};

/* ------------------------------------------------------------------ */
/* Lead status                                                         */
/* ------------------------------------------------------------------ */

/**
 * The owner's follow-up pipeline, in order. Stored as-is in `leads.status`, so
 * this list is also the server-side allowlist (see api/owner/leads/[id].ts).
 */
export const LEAD_STATUSES = ['new', 'contacted', 'interested', 'booked', 'not_interested'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const leadStatusMeta: Record<string, { label: string; classes: string }> = {
  new: { label: 'New', classes: 'bg-brand-100 text-brand-800' },
  contacted: { label: 'Contacted', classes: 'bg-sky-100 text-sky-800' },
  interested: { label: 'Interested', classes: 'bg-emerald-100 text-emerald-800' },
  booked: { label: 'Booked', classes: 'bg-teal-100 text-teal-800' },
  not_interested: { label: 'Not interested', classes: 'bg-slate-100 text-slate-600' },
};

export const leadStatusLabel = (status: string): string =>
  leadStatusMeta[status]?.label ?? status.replaceAll('_', ' ');

/* ------------------------------------------------------------------ */
/* Verification documents (tiered checklist, see /owner/verification)  */
/* ------------------------------------------------------------------ */

export const docTypeMeta: Record<string, { label: string; tier: 'required' | 'conditional' | 'other' }> = {
  identity: { label: 'Government ID (owner)', tier: 'required' },
  ownership: { label: 'Ownership proof — sale deed / title', tier: 'required' },
  lease_noc: { label: 'Rent agreement + landlord NOC', tier: 'required' },
  municipal_trade: { label: 'Municipal / trade licence', tier: 'conditional' },
  fire_noc: { label: 'Fire safety NOC', tier: 'conditional' },
  fssai: { label: 'FSSAI food licence', tier: 'conditional' },
  gst: { label: 'GST registration', tier: 'conditional' },
  other: { label: 'Other document', tier: 'other' },
};

/** Human label for a stored doc_type; unknown values degrade gracefully. */
export const docTypeLabel = (value: string): string =>
  docTypeMeta[value]?.label ?? value.replaceAll('_', ' ');

/* ------------------------------------------------------------------ */
/* Option catalogs (mirror the DTO vocabulary in src/data)             */
/* ------------------------------------------------------------------ */

export const propertyTypeOptions = [
  { value: 'pg', label: 'PG' },
  { value: 'co-living', label: 'Co-living' },
  { value: 'flat', label: 'Flat' },
];

export const genderOptions = [
  { value: 'boys', label: 'Boys' },
  { value: 'girls', label: 'Girls' },
  { value: 'co-ed', label: 'Co-ed' },
];

export const roomTypeOptions = [
  { value: 'single', label: 'Single', occupancy: 'Single sharing' },
  { value: 'double', label: 'Double', occupancy: 'Double sharing' },
  { value: 'triple', label: 'Triple', occupancy: 'Triple sharing' },
  { value: 'four-plus', label: '4+ sharing', occupancy: '4+ sharing' },
];

export const foodTypeOptions = [
  { value: 'veg', label: 'Vegetarian only' },
  { value: 'non-veg', label: 'Non-veg' },
  { value: 'both', label: 'Veg & non-veg' },
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Cheapest monthly rent across a listing's rooms, or null when empty. */
export const minRentOf = (listing: Listing): number | null => {
  if (!listing.rooms.length) return null;
  return Math.min(...listing.rooms.map((r) => r.rent));
};

/** Human "₹10,000 – ₹18,000 /month" summary for a listing. */
export const rentRangeOf = (listing: Listing): string => {
  if (!listing.rooms.length) return '—';
  const rents = listing.rooms.map((r) => r.rent);
  const min = Math.min(...rents);
  const max = Math.max(...rents);
  if (min === max) return `${formatINR(min)}/month`;
  return `${formatINR(min)} – ${formatINR(max)}/month`;
};

/** Short date for India, e.g. "12 Aug 2026". */
export const formatShortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Date and time an enquiry arrived, e.g. "12 Aug 2026, 4:35 pm". */
export const formatEnquiryTimestamp = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

/**
 * Publication window for a live listing, e.g. "Basic · live until 12 Aug 2026"
 * or "Verified · expired 12 Aug 2026". Returns null when no window has been
 * opened (drafts and pending listings have not been approved yet).
 *
 * This is informational only. Renewal is not implemented in this build, so
 * callers must not render an action button from this label.
 */
export const listingPlanLabel = (
  listing: Pick<Listing, 'plan' | 'expiresAt' | 'isExpired'>
): string | null => {
  if (!listing.expiresAt) return null;
  const name = listing.plan === 'verified' ? 'Verified' : 'Basic';
  const date = formatShortDate(listing.expiresAt);
  return listing.isExpired ? `${name} · expired ${date}` : `${name} · live until ${date}`;
};

/** Relative label like "3d ago" / "2w ago" / "5 Aug 2026". */
export const formatRelativeDate = (iso: string): string => {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const days = Math.floor((now - then) / (1000 * 60 * 60 * 24));
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return formatShortDate(iso);
};

/**
 * Budget chip label used on enquiries.
 *
 * `custom:12000` is how the enquiry form stores a typed amount; older rows may
 * hold just the range code.
 */
export const budgetLabel = (budget: string | null): string => {
  if (budget?.startsWith('custom:')) {
    const amount = Number(budget.slice('custom:'.length));
    return Number.isFinite(amount) && amount > 0 ? `${formatINR(amount)} (custom)` : 'Custom budget';
  }
  return budget === 'under-10'
    ? 'Under ₹10k'
    : budget === '10-15'
      ? '₹10k – ₹15k'
      : budget === '15-20'
        ? '₹15k – ₹20k'
        : budget === '20-plus'
          ? '₹20k +'
          : 'Any budget';
};

/** Room type chip label used on enquiries. */
export const enquiryRoomTypeLabel = (value: string | null): string =>
  value === 'single'
    ? 'Single sharing'
    : value === 'double'
      ? 'Double sharing'
      : value === 'triple'
        ? 'Triple sharing'
        : value === 'any'
          ? 'Any room type'
          : 'Not specified';

/** Move-in month "YYYY-MM" → "Aug 2026". */
export const moveInLabel = (month: string | null): string => {
  if (!month) return 'Flexible';
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return 'Flexible';
  const date = new Date(Date.UTC(y, m - 1, 1));
  return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
};
