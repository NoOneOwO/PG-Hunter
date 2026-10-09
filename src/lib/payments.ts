/**
 * PG Hunter — pure manual-payment rules.
 *
 * There is no payment gateway. An owner pays the platform's UPI id and submits
 * the UPI reference; an admin confirms the money arrived. Everything here is
 * free of `cloudflare:workers`/`astro:*` so it can be unit tested under plain
 * Node (see test/payments.test.mts). The D1 reads/writes live in
 * src/lib/server/payments.ts.
 *
 * The one rule that must never bend: a payment is only real when its status is
 * `confirmed`, and only an admin can set that.
 */

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

export const PAYMENT_METHODS = ['upi'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['submitted', 'confirmed', 'rejected'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const isPaymentStatus = (value: unknown): value is PaymentStatus =>
  typeof value === 'string' && (PAYMENT_STATUSES as readonly string[]).includes(value);

export const isPaymentMethod = (value: unknown): value is PaymentMethod =>
  typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value);

/** Display metadata, matching the badge styling used across the admin shell. */
export const paymentStatusMeta: Record<PaymentStatus, { label: string; classes: string; dot: string }> = {
  submitted: {
    label: 'Awaiting confirmation',
    classes: 'bg-amber-100 text-amber-900 border-amber-200',
    dot: 'bg-amber-500',
  },
  confirmed: {
    label: 'Confirmed',
    classes: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    dot: 'bg-emerald-500',
  },
  rejected: {
    label: 'Rejected',
    classes: 'bg-rose-100 text-rose-700 border-rose-200',
    dot: 'bg-rose-500',
  },
};

/* ------------------------------------------------------------------ */
/* UPI configuration                                                   */
/* ------------------------------------------------------------------ */

export interface UpiConfig {
  /** True only when a shape-valid UPI id is configured. */
  configured: boolean;
  upiId: string | null;
  payeeName: string | null;
}

const UPI_ID_RE = /^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}$/;

/**
 * Resolve the platform UPI details from runtime config.
 *
 * When no valid UPI id is configured the checkout must say so rather than show
 * a placeholder account a payer could actually send money to. So an invalid or
 * absent id resolves to `configured: false` with no id exposed.
 */
export const resolveUpiConfig = (
  raw: { UPI_ID?: string | null; UPI_PAYEE_NAME?: string | null } = {}
): UpiConfig => {
  const upiId = (raw.UPI_ID ?? '').trim();
  const payeeName = (raw.UPI_PAYEE_NAME ?? '').trim();
  const valid = UPI_ID_RE.test(upiId);
  return {
    configured: valid,
    upiId: valid ? upiId : null,
    payeeName: payeeName || null,
  };
};

/**
 * A UPI deep link a phone can act on (`upi://pay?...`). Returns null when the
 * UPI id is not configured, so the UI never renders a dead pay button.
 */
export const buildUpiUri = (
  config: UpiConfig,
  options: { amountInr: number; note?: string } 
): string | null => {
  if (!config.configured || !config.upiId) return null;
  const amount = Math.max(0, Math.round(Number(options.amountInr) || 0));
  if (amount <= 0) return null;
  const params = new URLSearchParams();
  params.set('pa', config.upiId);
  if (config.payeeName) params.set('pn', config.payeeName);
  params.set('am', String(amount));
  params.set('cu', 'INR');
  if (options.note) params.set('tn', options.note.slice(0, 50));
  return `upi://pay?${params.toString()}`;
};

/* ------------------------------------------------------------------ */
/* Submission validation                                              */
/* ------------------------------------------------------------------ */

export interface PaymentDraftInput {
  reference?: unknown;
  note?: unknown;
}

export interface CleanPaymentDraft {
  reference: string;
  note: string | null;
}

export type PaymentValidationResult =
  | { ok: true; value: CleanPaymentDraft }
  | { ok: false; errors: Record<string, string> };

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Trim, drop control characters and collapse internal whitespace. */
export const normaliseReference = (value: string): string =>
  value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');

const REFERENCE_RE = /^[A-Za-z0-9 .\-/]+$/;

/**
 * Validate what an owner typed after paying.
 *
 * Field keys match the form inputs so the client can render the error under the
 * exact field that produced it. A reference is mandatory: an approval click with
 * no UTR is not proof money moved.
 */
export const validatePaymentRequest = (input: PaymentDraftInput): PaymentValidationResult => {
  const errors: Record<string, string> = {};

  const reference = normaliseReference(asText(input.reference));
  if (!reference) {
    errors.reference = 'Enter the UPI reference / UTR from your payment app.';
  } else if (reference.length < 6) {
    errors.reference = 'That looks too short — enter the full UTR (at least 6 characters).';
  } else if (reference.length > 64) {
    errors.reference = 'Keep the reference under 64 characters.';
  } else if (!REFERENCE_RE.test(reference)) {
    errors.reference = 'Use only letters, numbers, spaces, and . - / characters.';
  }

  const note = asText(input.note).trim();
  if (note.length > 500) {
    errors.note = 'Keep the note under 500 characters.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { reference, note: note || null } };
};

/* ------------------------------------------------------------------ */
/* Row mapping + reporting                                             */
/* ------------------------------------------------------------------ */

export interface PlanPaymentRow {
  id: string;
  owner_id: string;
  listing_id: string | null;
  plan_slug: string;
  amount_inr: number;
  method: string;
  reference: string;
  status: string;
  payer_note: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  /** Optional joined display fields. */
  plan_name?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  listing_name?: string | null;
}

export interface PlanPayment {
  id: string;
  ownerId: string;
  listingId: string | null;
  plan: 'basic' | 'verified';
  planName: string | null;
  amountInr: number;
  method: PaymentMethod;
  reference: string;
  status: PaymentStatus;
  payerNote: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  ownerName: string | null;
  ownerEmail: string | null;
  listingName: string | null;
}

/** Map a storage row to the app shape, or null when it cannot be trusted. */
export const paymentFromRow = (row: PlanPaymentRow | null | undefined): PlanPayment | null => {
  if (!row) return null;

  const plan = row.plan_slug === 'verified' ? 'verified' : row.plan_slug === 'basic' ? 'basic' : null;
  if (!plan) return null;

  if (!isPaymentStatus(row.status)) return null;

  const method: PaymentMethod = isPaymentMethod(row.method) ? row.method : 'upi';

  const amountInr =
    Number.isFinite(row.amount_inr) && row.amount_inr >= 0 ? Math.round(row.amount_inr) : 0;

  return {
    id: row.id,
    ownerId: row.owner_id,
    listingId: row.listing_id ?? null,
    plan,
    planName: row.plan_name ?? null,
    amountInr,
    method,
    reference: row.reference,
    status: row.status,
    payerNote: row.payer_note ?? null,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at ?? null,
    reviewNote: row.review_note ?? null,
    createdAt: row.created_at,
    ownerName: row.owner_name ?? null,
    ownerEmail: row.owner_email ?? null,
    listingName: row.listing_name ?? null,
  };
};

export interface RevenueSummary {
  /** Rupees actually confirmed by an admin. Never a projection. */
  confirmedTotal: number;
  confirmedCount: number;
  pendingCount: number;
  rejectedCount: number;
}

/**
 * Summarise payments for the admin revenue view.
 *
 * Only `confirmed` rows contribute to revenue. Non-finite or negative amounts
 * contribute nothing rather than poisoning the total.
 */
export const summarisePayments = (
  rows: Array<{ status: string; amount_inr: number }>
): RevenueSummary => {
  let confirmedTotal = 0;
  let confirmedCount = 0;
  let pendingCount = 0;
  let rejectedCount = 0;

  for (const row of rows) {
    if (row.status === 'confirmed') {
      confirmedCount += 1;
      const amount = Number(row.amount_inr);
      if (Number.isFinite(amount) && amount > 0) confirmedTotal += Math.round(amount);
    } else if (row.status === 'submitted') {
      pendingCount += 1;
    } else if (row.status === 'rejected') {
      rejectedCount += 1;
    }
  }

  return { confirmedTotal, confirmedCount, pendingCount, rejectedCount };
};
