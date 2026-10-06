/**
 * PG Hunter — pure Creator programme rules.
 *
 * Deliberately free of any `cloudflare:workers` / `env` import so the logic can
 * be unit tested under plain Node (see test/creators.test.mts). Everything that
 * touches D1 lives in src/lib/server/creators.ts and calls in here for the
 * decisions.
 *
 * The rules encoded here are the ones the product promises on /earn:
 *   - applying is a real form with real validation, not a mailto link;
 *   - an application is reviewed by a human and lands in pending / approved /
 *     rejected, and only an approved creator is assigned work;
 *   - earning is per approved assignment, so a rupee can only be counted from a
 *     row that actually exists.
 */

/* ------------------------------------------------------------------ */
/* Status + skill vocabulary                                           */
/* ------------------------------------------------------------------ */

export const CREATOR_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type CreatorStatus = (typeof CREATOR_STATUSES)[number];

export const ASSIGNMENT_STATUSES = [
  'assigned',
  'in_progress',
  'submitted',
  'approved',
  'rejected',
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const CREATOR_SKILLS = ['video', 'photo', 'both'] as const;
export type CreatorSkill = (typeof CREATOR_SKILLS)[number];

export const isCreatorStatus = (value: unknown): value is CreatorStatus =>
  typeof value === 'string' && (CREATOR_STATUSES as readonly string[]).includes(value);

export const isAssignmentStatus = (value: unknown): value is AssignmentStatus =>
  typeof value === 'string' && (ASSIGNMENT_STATUSES as readonly string[]).includes(value);

export const isCreatorSkill = (value: unknown): value is CreatorSkill =>
  typeof value === 'string' && (CREATOR_SKILLS as readonly string[]).includes(value);

/* ------------------------------------------------------------------ */
/* Application validation                                              */
/* ------------------------------------------------------------------ */

/** Raw, untrusted shape coming off a request body. */
export interface CreatorApplicationInput {
  fullName?: unknown;
  phone?: unknown;
  city?: unknown;
  areas?: unknown;
  primarySkill?: unknown;
  bio?: unknown;
  portfolioUrl?: unknown;
  equipment?: unknown;
  availability?: unknown;
  payoutUpi?: unknown;
}

/** The validated, trimmed shape that is safe to persist. */
export interface CleanCreatorApplication {
  fullName: string;
  phone: string;
  city: string;
  areas: string;
  primarySkill: CreatorSkill;
  bio: string;
  portfolioUrl: string | null;
  equipment: string | null;
  availability: string | null;
  payoutUpi: string | null;
}

export type CreatorValidationResult =
  | { ok: true; value: CleanCreatorApplication }
  | { ok: false; errors: Record<string, string> };

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const UPI_RE = /^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}$/;
const DIGITS_RE = /\D/g;
const CODE_RE = /^[A-Z0-9]{3,16}$/;

/** Phone is deliberately permissive (international formats exist) but numeric. */
export const phoneDigits = (value: string): string => value.replace(DIGITS_RE, '');

/**
 * Validate an application.
 *
 * Field keys match the form's `name` attributes so the client can render an
 * error under the exact input that produced it. Optional fields are `null` when
 * absent rather than `''`, so "not provided" is distinguishable in storage.
 */
export const validateCreatorApplication = (input: CreatorApplicationInput): CreatorValidationResult => {
  const errors: Record<string, string> = {};

  const fullName = asText(input.fullName);
  if (fullName.length < 2) errors.fullName = 'Please enter your full name.';
  else if (fullName.length > 80) errors.fullName = 'Keep your name under 80 characters.';

  const phone = asText(input.phone);
  const digits = phoneDigits(phone);
  if (!phone) errors.phone = 'A phone number is required so we can reach you.';
  else if (digits.length < 7 || digits.length > 15) {
    errors.phone = 'Enter 7–15 digits, e.g. +91 98765 43210.';
  }

  const city = asText(input.city);
  if (city.length < 2) errors.city = 'Which city will you cover?';
  else if (city.length > 60) errors.city = 'Keep the city under 60 characters.';

  const areas = asText(input.areas);
  if (areas.length > 200) errors.areas = 'Keep the areas under 200 characters.';

  const primarySkill = isCreatorSkill(input.primarySkill) ? input.primarySkill : null;
  if (!primarySkill) errors.primarySkill = 'Pick what you mainly shoot.';

  const bio = asText(input.bio);
  if (bio.length < 20) errors.bio = 'Tell us a little more — at least 20 characters.';
  else if (bio.length > 600) errors.bio = 'Keep your introduction under 600 characters.';

  const portfolioRaw = asText(input.portfolioUrl);
  let portfolioUrl: string | null = null;
  if (portfolioRaw) {
    if (!/^https?:\/\//i.test(portfolioRaw)) {
      errors.portfolioUrl = 'Use a full link that starts with http:// or https://.';
    } else if (portfolioRaw.length > 300) {
      errors.portfolioUrl = 'That link is too long.';
    } else {
      portfolioUrl = portfolioRaw;
    }
  }

  const equipment = asText(input.equipment);
  if (equipment.length > 200) errors.equipment = 'Keep this under 200 characters.';

  const availability = asText(input.availability);
  if (availability.length > 120) errors.availability = 'Keep this under 120 characters.';

  const payoutUpi = asText(input.payoutUpi);
  let normalizedUpi: string | null = null;
  if (payoutUpi) {
    if (!UPI_RE.test(payoutUpi)) {
      errors.payoutUpi = 'That does not look like a UPI id (name@bank).';
    } else if (payoutUpi.length > 60) {
      errors.payoutUpi = 'That UPI id is too long.';
    } else {
      normalizedUpi = payoutUpi.toLowerCase();
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      fullName,
      phone,
      city,
      areas,
      primarySkill: primarySkill!,
      bio,
      portfolioUrl,
      equipment: equipment || null,
      availability: availability || null,
      payoutUpi: normalizedUpi,
    },
  };
};

/* ------------------------------------------------------------------ */
/* Referral codes                                                      */
/* ------------------------------------------------------------------ */

/**
 * Normalize a code typed in a URL or body. Uppercase alphanumerics only, so
 * `?ref=pgh-riya` and `PGHRIYA` resolve to the same creator.
 */
export const normalizeReferralCode = (value: unknown): string =>
  (typeof value === 'string' ? value : '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const isValidReferralCode = (value: unknown): boolean =>
  CODE_RE.test(normalizeReferralCode(value));

/** First name-ish token from a display name, letters/digits only. */
const nameToken = (name: string): string => {
  const first = name.trim().split(/\s+/)[0] ?? '';
  const cleaned = first.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.slice(0, 8) || 'CREATOR';
};

/**
 * Deterministic given its entropy, so it is unit-testable. `entropy` is the
 * caller's random hex; the server retries on the (vanishingly rare) collision.
 *
 * The code is deliberately separator-free. `normalizeReferralCode` strips
 * everything outside A-Z0-9 so a code pasted from anywhere resolves, and that
 * only holds if the stored code is itself in that alphabet — a stored
 * `RIYA-1C33` could never be looked up again, because the lookup normalizes to
 * `RIYA1C33`.
 */
export const buildReferralCode = (name: string, entropy: string): string => {
  const suffix = entropy.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4).padEnd(4, 'X');
  return `${nameToken(name)}${suffix}`;
};

/* ------------------------------------------------------------------ */
/* Earnings                                                            */
/* ------------------------------------------------------------------ */

export interface AssignmentLike {
  payout: number;
  status: AssignmentStatus;
  paidAt?: string | null;
}

export interface EarningsSummary {
  /** Rupees approved as earned (a real, reviewed assignment). */
  lifetime: number;
  /** Rupees approved but not yet marked paid. */
  pending: number;
  /** Rupees already paid out. */
  paid: number;
  /** Number of approved assignments. */
  completedCount: number;
  /**
   * Rupees tied up in work that is assigned, in progress or submitted —
   * deliberately NOT counted as earnings, only as "in the pipeline".
   */
  inProgressPayout: number;
}

/**
 * Sum earnings from real assignment rows only.
 *
 * `lifetime` counts approved work; an assignment that is merely assigned or
 * submitted is exposed separately as `inProgressPayout` so the dashboard can
 * show a pipeline figure without ever presenting unearned money as earned.
 */
export const earningsSummary = (assignments: AssignmentLike[]): EarningsSummary => {
  let lifetime = 0;
  let paid = 0;
  let completedCount = 0;
  let inProgressPayout = 0;

  for (const item of assignments) {
    const payout = Number.isFinite(item.payout) ? item.payout : 0;
    if (item.status === 'approved') {
      lifetime += payout;
      completedCount += 1;
      if (item.paidAt) paid += payout;
    } else if (item.status === 'assigned' || item.status === 'in_progress' || item.status === 'submitted') {
      inProgressPayout += payout;
    }
  }

  return { lifetime, pending: lifetime - paid, paid, completedCount, inProgressPayout };
};

/* ------------------------------------------------------------------ */
/* Profile completeness                                                */
/* ------------------------------------------------------------------ */

export interface CompletableProfile {
  fullName: string;
  phone: string;
  city: string;
  bio: string;
  payoutUpi: string | null;
}

const CHECKS: { key: keyof CompletableProfile; label: string }[] = [
  { key: 'fullName', label: 'Add your full name' },
  { key: 'phone', label: 'Add a phone number' },
  { key: 'city', label: 'Add the city you cover' },
  { key: 'bio', label: 'Write a short introduction' },
  { key: 'payoutUpi', label: 'Add a UPI id for payouts' },
];

/** Missing fields for an existing profile, so the dashboard can nudge. */
export const creatorProfileGaps = (profile: CompletableProfile): string[] =>
  CHECKS.filter((check) => !String(profile[check.key] ?? '').trim()).map((check) => check.label);

/* ------------------------------------------------------------------ */
/* Presentation metadata (shared by the dashboard and admin UI)        */
/* ------------------------------------------------------------------ */

export interface StatusMeta {
  label: string;
  hint: string;
  /** Tailwind classes for a `.badge`. */
  classes: string;
  /** Tailwind class for the leading dot. */
  dot: string;
}

export const creatorStatusMeta: Record<CreatorStatus, StatusMeta> = {
  pending: {
    label: 'Application under review',
    hint: 'An admin reviews new applications. You will see a decision here.',
    classes: 'bg-amber-100 text-amber-800',
    dot: 'bg-amber-500',
  },
  approved: {
    label: 'Approved creator',
    hint: 'You can be assigned PGs to shoot and earn per approved assignment.',
    classes: 'bg-emerald-100 text-emerald-800',
    dot: 'bg-emerald-500',
  },
  rejected: {
    label: 'Not approved',
    hint: 'Read the reviewer note, fix what was asked and resubmit.',
    classes: 'bg-rose-100 text-rose-700',
    dot: 'bg-rose-500',
  },
};

export const assignmentStatusMeta: Record<AssignmentStatus, StatusMeta> = {
  assigned: {
    label: 'Assigned',
    hint: 'Visit the PG, shoot the walkthrough and submit it.',
    classes: 'bg-brand-100 text-brand-800',
    dot: 'bg-brand-600',
  },
  in_progress: {
    label: 'In progress',
    hint: 'You have started this shoot.',
    classes: 'bg-sky-100 text-sky-800',
    dot: 'bg-sky-500',
  },
  submitted: {
    label: 'Submitted — awaiting review',
    hint: 'Admin is reviewing your upload.',
    classes: 'bg-amber-100 text-amber-800',
    dot: 'bg-amber-500',
  },
  approved: {
    label: 'Approved',
    hint: 'The work passed review and the payout is counted.',
    classes: 'bg-emerald-100 text-emerald-800',
    dot: 'bg-emerald-500',
  },
  rejected: {
    label: 'Sent back',
    hint: 'Read the note from the reviewer and resubmit.',
    classes: 'bg-rose-100 text-rose-700',
    dot: 'bg-rose-500',
  },
};

/** Which action, if any, a creator may take on an assignment right now. */
export const assignmentActionFor = (status: AssignmentStatus): 'start' | 'submit' | 'wait' | 'resubmit' => {
  if (status === 'assigned') return 'start';
  if (status === 'in_progress') return 'submit';
  if (status === 'rejected') return 'resubmit';
  return 'wait';
};
