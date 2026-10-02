/**
 * PG Hunter — client auth + user data layer (Cloudflare Worker backend).
 *
 * The browser talks to the same-origin Worker API (/api/*) which owns
 * authentication and data access (Cloudflare D1). Sessions are httpOnly
 * cookies, so no tokens ever touch JavaScript. Property *listings* remain
 * mock data (src/data) until listings move into D1, so saved_pgs stores mock
 * property ids and the UI resolves them against src/data/properties.
 *
 * Backend setup: see CLOUDFLARE_SETUP.md.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'owner';
  isAdmin?: boolean;
  phone?: string;
  collegeSlug?: string;
  avatar?: string | null;
  createdAt: string;
  provider: string;
}

export interface AuthResult {
  user?: AppUser;
  /** Kept for API compatibility — email confirmation is not used in the MVP. */
  needsConfirmation?: boolean;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Auth change notifications                                           */
/* ------------------------------------------------------------------ */

type AuthListener = (user: AppUser | null) => void;
const listeners = new Set<AuthListener>();

let cachedUser: AppUser | null | undefined; // undefined = not fetched yet

export const onAuthChange = (cb: AuthListener): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const emit = (user: AppUser | null): void => {
  cachedUser = user;
  listeners.forEach((cb) => cb(user));
  window.dispatchEvent(new CustomEvent('pghunter:auth', { detail: { user } }));
};

/* ------------------------------------------------------------------ */
/* Low-level fetch helpers                                             */
/* ------------------------------------------------------------------ */

const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
};

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

/** Currently logged-in user, or null. Cached; pass `true` to force a refetch. */
export const getSession = async (force = false): Promise<AppUser | null> => {
  if (!force && cachedUser !== undefined) return cachedUser;
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!res.ok) {
      if (cachedUser !== undefined) emit(null);
      return null;
    }
    const { user } = (await res.json()) as { user: AppUser | null };
    emit(user);
    return user;
  } catch {
    if (cachedUser !== undefined) emit(null);
    return null;
  }
};

/** Alias used by card scripts — resolves to the logged-in user or null. */
export const getCurrentSession = (): Promise<AppUser | null> => getSession();

/* ------------------------------------------------------------------ */
/* Auth actions                                                        */
/* ------------------------------------------------------------------ */

const friendlyError = (message: string): string => message;

/** Create a new account with email + password. */
export const register = async (input: {
  name: string;
  email: string;
  password: string;
  role?: 'student' | 'owner';
}): Promise<AuthResult> => {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();

  if (!name) return { error: 'Please enter your name.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Please enter a valid email address.' };
  if (input.password.length < 6) return { error: 'Password must be at least 6 characters long.' };

  try {
    const { user } = await api<{ user: AppUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password: input.password, role: input.role ?? 'student' }),
    });
    emit(user);
    return { user };
  } catch (e) {
    return { error: friendlyError((e as Error).message) };
  }
};

/** Log in with email + password. */
export const login = async (input: { email: string; password: string }): Promise<AuthResult> => {
  try {
    const { user } = await api<{ user: AppUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: input.email.trim().toLowerCase(), password: input.password }),
    });
    emit(user);
    return { user };
  } catch (e) {
    return { error: friendlyError((e as Error).message) };
  }
};

/**
 * Start Google OAuth. The user leaves to Google and the Worker's
 * /api/auth/google/callback completes the sign-in and redirects back.
 * When sign-up was initiated via ?role=owner, that intent is preserved via
 * the `role` query so a brand-new Google account can be created as an owner.
 */
export const signInWithGoogle = async (next?: string, role?: 'student' | 'owner'): Promise<{ error?: string }> => {
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const params = new URLSearchParams({ next: safeNext });
  if (role === 'owner') params.set('role', 'owner');
  window.location.href = `/api/auth/google?${params.toString()}`;
  return {};
};

/** Sign out — the Worker destroys the session and clears the cookie. */
export const signOut = async (): Promise<void> => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch {
    // Even if the request fails, clear local state.
  }
  emit(null);
};

/** Redirect to the login page (preserving a next destination) when logged out. */
export const redirectToLogin = (next?: string): void => {
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  window.location.replace(`/login?next=${encodeURIComponent(safeNext)}`);
};

/** Initials avatar, e.g. "RS" for "Riya Sharma". */
export const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export const updateProfile = async (patch: {
  name?: string;
  phone?: string;
  collegeSlug?: string;
}): Promise<{ user?: AppUser; error?: string }> => {
  try {
    const { user } = await api<{ user: AppUser }>('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
    emit(user);
    return { user };
  } catch (e) {
    return { error: friendlyError((e as Error).message) };
  }
};

/* ------------------------------------------------------------------ */
/* Saved PGs                                                           */
/* ------------------------------------------------------------------ */

let savedIdsCache: string[] | null = null;

export const getSavedIds = async (force = false): Promise<string[]> => {
  if (!force && savedIdsCache) return savedIdsCache;
  if (!(await getSession())) return [];
  try {
    const { ids } = await api<{ ids: string[] }>('/api/saved');
    savedIdsCache = ids;
    return ids;
  } catch {
    return [];
  }
};

export const isSaved = async (propertyId: string): Promise<boolean> =>
  (await getSavedIds()).includes(propertyId);

/** Toggle a property in the saved list. */
export const toggleSaved = async (
  propertyId: string
): Promise<{ saved: boolean; user: AppUser | null; error?: string }> => {
  const user = await getSession();
  if (!user) return { saved: false, user: null };

  try {
    const { saved } = await api<{ saved: boolean }>('/api/saved', {
      method: 'POST',
      body: JSON.stringify({ propertyId }),
    });
    savedIdsCache = null;
    return { saved, user };
  } catch (e) {
    return { saved: false, user, error: friendlyError((e as Error).message) };
  }
};

/* ------------------------------------------------------------------ */
/* Enquiries                                                           */
/* ------------------------------------------------------------------ */

export const createEnquiry = async (input: {
  propertyId: string;
  budget?: string;
  moveInMonth?: string;
  message?: string;
}): Promise<{ error?: string }> => {
  const user = await getSession();
  if (!user) return { error: 'Not logged in.' };

  try {
    await api('/api/enquiries', { method: 'POST', body: JSON.stringify(input) });
    return {};
  } catch (e) {
    return { error: friendlyError((e as Error).message) };
  }
};

/* ------------------------------------------------------------------ */
/* Owner + admin backend (pages are built separately)                  */
/* ------------------------------------------------------------------ */

/** FormData upload — fetch sets the multipart boundary itself. */
const apiForm = async <T>(path: string, form: FormData): Promise<T> => {
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', body: form });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
};

/* ---- Shared listing shape ----------------------------------------- */

export interface ListingRoom {
  id?: number;
  roomType: string;
  occupancy: string;
  rent: number;
  deposit: number;
  available: boolean;
}

export interface ListingMedia {
  id: string;
  type: 'photo' | 'video' | 'document';
  provider: 'r2' | 'youtube' | 'unsplash';
  externalId: string;
  url: string | null;
  title: string;
}

export interface Listing {
  id: string;
  ownerId: string;
  name: string;
  propertyType: string;
  gender: string;
  address: string;
  locality: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  description: string;
  rules: string[];
  curfew: string | null;
  food: { available: boolean; type?: 'veg' | 'non-veg' | 'both'; monthlyCost?: number };
  amenitySlugs: string[];
  status: 'draft' | 'pending' | 'active' | 'rejected';
  verificationStatus: 'unverified' | 'pg_hunter_verified' | 'rishabh_irl_verified';
  rejectionReason: string | null;
  rooms: ListingRoom[];
  media: ListingMedia[];
  createdAt: string;
  updatedAt: string;
}

export interface ListingInput {
  name: string;
  propertyType?: string;
  gender?: string;
  address?: string;
  locality?: string;
  city?: string;
  latitude?: number | null;
  longitude?: number | null;
  description?: string;
  rules?: string[];
  curfew?: string;
  food?: { available: boolean; type?: 'veg' | 'non-veg' | 'both'; monthlyCost?: number };
  amenitySlugs?: string[];
  rooms: ListingRoom[];
  pendingMediaIds?: string[];
}

/* ---- Owner API ---------------------------------------------------- */

export interface VerificationDoc {
  id: string;
  listingId: string | null;
  docType: string;
  fileName: string;
  url: string;
  status: 'pending' | 'approved' | 'rejected';
  notes: string | null;
  createdAt: string;
}

export interface OwnerLead {
  id: number;
  property_id: string;
  property_name: string | null;
  budget: string | null;
  move_in_month: string | null;
  message: string | null;
  source: string;
  status: string;
  created_at: string;
  student_name: string | null;
}

export interface OwnerOverview {
  user: AppUser;
  stats: {
    listings: number;
    activeListings: number;
    pendingListings: number;
    leads: number;
    newLeads: number;
    verification: { status: 'none' | 'pending' | 'approved'; documents: number };
    analytics: {
      listingStatuses: { status: Listing['status']; count: number }[];
      enquiriesByDay: { date: string; count: number }[];
      reachByDay: { date: string; views: number }[];
      topListings: { id: string; name: string; enquiries: number; views: number }[];
      totals: { views: number; availableRooms: number; photos: number };
    };
  };
  listings: Listing[];
  leads: OwnerLead[];
}

/** Backend for the owner landing page (after auth). */
export const getOwnerOverview = (): Promise<OwnerOverview> => api('/api/owner/me');

export const getOwnerListings = (): Promise<{ listings: Listing[] }> => api('/api/owner/listings');

export const getOwnerListing = (id: string): Promise<{ listing: Listing }> =>
  api(`/api/owner/listings/${encodeURIComponent(id)}`);

export const createListing = (input: ListingInput): Promise<{ listing: Listing }> =>
  api('/api/owner/listings', { method: 'POST', body: JSON.stringify(input) });

export const updateListing = (id: string, input: ListingInput): Promise<{ listing: Listing }> =>
  api(`/api/owner/listings/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });

export const deleteListing = (id: string): Promise<{ ok: boolean }> =>
  api(`/api/owner/listings/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const submitListing = (id: string): Promise<{ listing: Listing }> =>
  api(`/api/owner/listings/${encodeURIComponent(id)}/submit`, { method: 'POST' });

export const getOwnerLeads = (): Promise<{ leads: OwnerLead[] }> => api('/api/owner/leads');

export const getVerificationState = (): Promise<{
  status: 'none' | 'pending' | 'approved';
  documents: VerificationDoc[];
}> => api('/api/owner/verification');

/**
 * Upload an image/document (multipart).
 * purpose: 'listing-images' | 'listing-documents' | 'verification'.
 * Optional form fields: listingId, docType (for verification).
 */
export const uploadFile = (
  purpose: 'listing-images' | 'listing-documents' | 'verification',
  file: File,
  extra?: { listingId?: string; docType?: string }
): Promise<{ ok: boolean; file: { id: string; key: string; url: string; fileName: string; purpose: string } }> => {
  const form = new FormData();
  form.set('purpose', purpose);
  if (extra?.listingId) form.set('listingId', extra.listingId);
  if (extra?.docType) form.set('docType', extra.docType);
  form.set('file', file);
  return apiForm('/api/media', form);
};

/* ---- Owner media management -------------------------------------- */

/** Add a video embed (YouTube / Vimeo) to a listing. */
export const addVideo = (input: {
  listingId: string;
  url: string;
  title?: string;
}): Promise<{
  ok: boolean;
  media: ListingMedia;
}> => api('/api/owner/media', { method: 'POST', body: JSON.stringify(input) });

/** Delete a photo or video from a listing. */
export const deleteMedia = (listingId: string, mediaId: string): Promise<{ ok: boolean }> =>
  api(`/api/owner/media?id=${encodeURIComponent(mediaId)}&listingId=${encodeURIComponent(listingId)}`, {
    method: 'DELETE',
  });

/** Reorder media items on a listing. mediaIds = desired order. */
export const reorderMedia = (listingId: string, mediaIds: string[]): Promise<{ ok: boolean }> =>
  api('/api/owner/media', {
    method: 'PUT',
    body: JSON.stringify({ listingId, mediaIds }),
  });

/* ---- Admin API ---------------------------------------------------- */

export interface AdminStats {
  users: { total: number; students: number; owners: number };
  listings: {
    total: number;
    drafts: number;
    pending: number;
    active: number;
    rejected: number;
  };
  leads: number;
  verifications: { pending: number; approved: number; rejected: number };
  tourVideos: number;
}

export interface AdminListing extends Listing {
  ownerName: string;
  ownerEmail: string;
}

export interface AdminVerificationDoc extends VerificationDoc {
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  listingName: string | null;
  reviewedAt: string | null;
}

export interface Tour {
  id: string;
  listingId: string | null;
  listingName: string | null;
  videoId: string;
  title: string;
  createdAt: string;
}

export const getAdminStats = (): Promise<AdminStats> => api('/api/admin/stats');

export const getAdminListings = (status?: string): Promise<{ listings: AdminListing[] }> =>
  api(`/api/admin/listings${status ? `?status=${encodeURIComponent(status)}` : ''}`);

export const setListingStatus = (
  id: string,
  patch: {
    status: 'pending' | 'active' | 'rejected';
    verificationStatus?: string;
    rejectionReason?: string;
  }
): Promise<{ listing: Listing }> =>
  api(`/api/admin/listings/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) });

export const getAdminVerifications = (status?: string): Promise<{ documents: AdminVerificationDoc[] }> =>
  api(`/api/admin/verifications${status ? `?status=${encodeURIComponent(status)}` : ''}`);

export const reviewVerification = (
  id: string,
  decision: 'approved' | 'rejected',
  notes?: string
): Promise<{ document: AdminVerificationDoc }> =>
  api(`/api/admin/verifications/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ decision, notes }),
  });

/** Room-tour videos (YouTube ids for the MVP). */
export const getTours = (): Promise<{ tours: Tour[] }> => api('/api/admin/tours');

export const addTour = (input: {
  listingId: string;
  videoId: string;
  title?: string;
}): Promise<{ tour: Tour }> => api('/api/admin/tours', { method: 'POST', body: JSON.stringify(input) });

export const deleteTour = (id: string): Promise<{ ok: boolean }> =>
  api(`/api/admin/tours/${encodeURIComponent(id)}`, { method: 'DELETE' });

/* ---- Public listings (for the future browse/search frontend) -------- */

export const getPublishedListings = (params?: {
  q?: string;
  budget?: string;
  roomType?: string;
  gender?: string;
  sort?: string;
}): Promise<{ count: number; listings: (Listing & { minRent: number })[] }> => {
  const search = new URLSearchParams();
  if (params?.q) search.set('q', params.q);
  if (params?.budget) search.set('budget', params.budget);
  if (params?.roomType) search.set('roomType', params.roomType);
  if (params?.gender) search.set('gender', params.gender);
  if (params?.sort) search.set('sort', params.sort);
  const qs = search.toString();
  return api(`/api/listings${qs ? `?${qs}` : ''}`);
};
