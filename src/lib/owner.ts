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

export const leadStatusMeta: Record<string, { label: string; classes: string }> = {
  new: { label: 'New', classes: 'bg-brand-100 text-brand-800' },
  contacted: { label: 'Contacted', classes: 'bg-sky-100 text-sky-800' },
  interested: { label: 'Interested', classes: 'bg-emerald-100 text-emerald-800' },
  not_interested: { label: 'Not interested', classes: 'bg-slate-100 text-slate-600' },
};

export const leadStatusLabel = (status: string): string =>
  leadStatusMeta[status]?.label ?? status.replaceAll('_', ' ');

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

/** Budget chip label used on enquiries. */
export const budgetLabel = (budget: string | null): string =>
  budget === 'under-10'
    ? 'Under ₹10k'
    : budget === '10-15'
      ? '₹10k – ₹15k'
      : budget === '15-20'
        ? '₹15k – ₹20k'
        : budget === '20-plus'
          ? '₹20k +'
          : 'Any budget';

/** Move-in month "YYYY-MM" → "Aug 2026". */
export const moveInLabel = (month: string | null): string => {
  if (!month) return 'Flexible';
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return 'Flexible';
  const date = new Date(Date.UTC(y, m - 1, 1));
  return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
};
