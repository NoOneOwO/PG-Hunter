/**
 * PG Hunter — admin inbox shaping (pure, dependency-free).
 *
 * The inbox is derived from real queue rows; this module only orders and counts
 * them. It is deliberately free of `cloudflare:workers`/`astro:*` so it can be
 * unit tested under plain Node. The database reads live in
 * `src/lib/server/adminInbox.ts`.
 */

export type AdminInboxKind =
  | 'listing'
  | 'verification'
  | 'experience'
  | 'report'
  | 'creator_application'
  | 'creator_submission'
  | 'payment';

export interface AdminInboxItem {
  /** Stable identity, e.g. `listing:<uuid>`. */
  id: string;
  kind: AdminInboxKind;
  title: string;
  detail: string;
  /** Same-origin admin path the item links to. */
  href: string;
  /** ISO timestamp of the event that created the item. */
  at: string;
}

export interface AdminInbox {
  items: AdminInboxItem[];
  /** Items newer than `lastSeenAt`. */
  unread: number;
  lastSeenAt: string;
}

/** Earliest watermark: an admin with no recorded state has "seen nothing". */
export const INBOX_EPOCH = '1970-01-01T00:00:00.000Z';

/**
 * Order newest-first, count items newer than the watermark, and cap the list.
 *
 * The cap bounds what the bell renders; the unread count is computed BEFORE the
 * cap so a large backlog is reported honestly rather than truncated to the
 * number of rows we happened to fetch.
 */
export const summariseInbox = (
  items: AdminInboxItem[],
  lastSeenAt: string = INBOX_EPOCH,
  cap = 20
): AdminInbox => {
  const sorted = [...items].sort((a, b) => {
    if (a.at === b.at) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    return a.at < b.at ? 1 : -1;
  });
  const unread = sorted.filter((item) => item.at > lastSeenAt).length;
  return { items: sorted.slice(0, cap), unread, lastSeenAt };
};
