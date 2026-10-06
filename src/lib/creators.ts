/**
 * PG Hunter — creator programme client.
 *
 * The browser talks to the same-origin Worker API (/api/creator/*), which owns
 * auth, validation and persistence. Sessions are httpOnly cookies, so nothing
 * here handles a token.
 *
 * Presentation metadata and the status vocabulary come from
 * src/lib/creatorRules.ts, which is pure and therefore safe to import in the
 * browser — the same module the server verified against, so the two can never
 * disagree about what "approved" or "submitted" means.
 */

import type { AppUser } from './auth';
import type { AssignmentStatus, CreatorSkill, CreatorStatus } from './creatorRules';

export { assignmentStatusMeta, assignmentActionFor, creatorStatusMeta } from './creatorRules';
export type {
  AssignmentStatus,
  CleanCreatorApplication,
  CreatorApplicationInput,
  CreatorSkill,
  CreatorStatus,
} from './creatorRules';

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export interface CreatorProfile {
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
  gaps: string[];
}

export interface CreatorAssignment {
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

export interface CreatorReferral {
  id: string;
  status: 'signed_up' | 'listed' | 'paid';
  note: string | null;
  createdAt: string;
}

export interface CreatorActivity {
  id: string;
  kind: 'application' | 'decision' | 'assignment' | 'submission' | 'payout' | 'referral';
  title: string;
  detail: string;
  at: string;
}

export interface CreatorEarnings {
  lifetime: number;
  pending: number;
  paid: number;
  completedCount: number;
  inProgressPayout: number;
}

export interface CreatorDashboardData {
  profile: CreatorProfile | null;
  assignments: CreatorAssignment[];
  referrals: { total: number; converted: number; recent: CreatorReferral[] };
  earnings: CreatorEarnings;
  activity: CreatorActivity[];
  user: AppUser;
}

export interface CreatorMutationResult<T> {
  data?: T;
  error?: string;
  /** Per-field messages keyed by the form input name. */
  fieldErrors?: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

const request = async <T>(
  path: string,
  init?: RequestInit
): Promise<CreatorMutationResult<T>> => {
  try {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        error: typeof data.error === 'string' ? data.error : 'Something went wrong. Please try again.',
        fieldErrors:
          data.fieldErrors && typeof data.fieldErrors === 'object'
            ? (data.fieldErrors as Record<string, string>)
            : undefined,
      };
    }
    return { data: data as T };
  } catch {
    return { error: 'Could not reach PG Hunter. Check your connection and try again.' };
  }
};

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

/** Everything the dashboard needs: profile, work, earnings, activity. */
export const getCreatorDashboard = (): Promise<CreatorMutationResult<CreatorDashboardData>> =>
  request<CreatorDashboardData>('/api/creator/me');

/**
 * Create or update the signed-in user's application.
 *
 * Takes the *validated* shape: the page runs the same `validateCreatorApplication`
 * the server runs, so what is sent has already been through the shared rules.
 */
export const applyAsCreator = (
  input: import('./creatorRules').CleanCreatorApplication
): Promise<CreatorMutationResult<{ profile: CreatorProfile }>> =>
  request<{ profile: CreatorProfile }>('/api/creator/apply', {
    method: 'POST',
    body: JSON.stringify(input),
  });

/** Move an assignment forward: start it, or submit the finished shoot. */
export const advanceCreatorAssignment = (
  id: string,
  action: 'start' | 'submit',
  payload: { note?: string; url?: string } = {}
): Promise<CreatorMutationResult<{ assignment: CreatorAssignment }>> =>
  request<{ assignment: CreatorAssignment }>(`/api/creator/assignments/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ action, ...payload }),
  });

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * The link a creator shares with PG owners. It opens the owner sign-up tab with
 * their code attached; /api/auth/register records the referral when the owner
 * account is created with email + password.
 */
export const creatorShareLink = (code: string): string => {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/login?mode=signup&role=owner&ref=${encodeURIComponent(code)}`;
};

/** "Today", "3 days ago", or a short date for anything older. */
export const formatWhen = (iso: string | null): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const formatDue = (iso: string | null): string => {
  if (!iso) return 'No deadline';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'No deadline';
  return `Due ${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
};

/**
 * Copy text to the clipboard.
 *
 * Returns false rather than throwing when the Clipboard API is unavailable
 * (insecure contexts, older browsers) — the caller's input is readonly and
 * selectable, so the toast tells the user to copy it by hand.
 */
export const copyText = async (value: string): Promise<boolean> => {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
};
