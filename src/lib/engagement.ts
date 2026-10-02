/**
 * PG Hunter — client engagement helpers (Phase 3A).
 * Wraps /api/views, /api/stats, /api/reactions, /api/experiences.
 * View dedup: one POST per listing per tab session (sessionStorage) + 5-min server window.
 */

export interface Stats {
  views: number;
  saves: number;
  likes: number;
  dislikes: number;
  userSaved: boolean;
  userReaction: 'like' | 'dislike' | null;
}

export interface ExperiencesData {
  experiences: {
    id: string;
    listing_id: string;
    user_id: string;
    rating: number | null;
    content: string;
    status: 'pending' | 'approved' | 'rejected' | 'spam';
    created_at: string;
    updated_at: string;
    user_name?: string;
  }[];
  count: number;
  avgRating: number | null;
}

const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...init });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
};

const getAnonId = (): string | null => {
  try {
    let id = localStorage.getItem('ph_anon_id');
    if (!id || !/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
      id = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
      localStorage.setItem('ph_anon_id', id);
    }
    return id;
  } catch {
    return null;
  }
};

export const recordView = async (listingId: string): Promise<void> => {
  try {
    const key = `ph_viewed_${listingId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    const anonId = getAnonId();
    await fetch('/api/views', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId, anonId }),
    }).catch(() => {});
  } catch {}
};

export const getStats = (listingId: string): Promise<Stats> =>
  api<Stats>(`/api/stats?listingId=${encodeURIComponent(listingId)}`);

export const getReactions = (listingId: string): Promise<{ likes: number; dislikes: number; userReaction: 'like' | 'dislike' | null }> =>
  api(`/api/reactions?listingId=${encodeURIComponent(listingId)}`);

export const setReaction = (
  listingId: string,
  reaction: 'like' | 'dislike' | null
): Promise<{ likes: number; dislikes: number; userReaction: 'like' | 'dislike' | null }> =>
  api(`/api/reactions`, { method: 'POST', body: JSON.stringify({ listingId, reaction }) });

export const getExperiences = (listingId: string): Promise<ExperiencesData> =>
  api(`/api/experiences?listingId=${encodeURIComponent(listingId)}`);

export const submitExperience = (listingId: string, content: string, rating?: number | null): Promise<{ experience: any }> =>
  api(`/api/experiences`, { method: 'POST', body: JSON.stringify({ listingId, content, rating }) });

export const formatCount = (n: number): string => {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
};
