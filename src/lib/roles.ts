/**
 * PG Hunter — pure role vocabulary for the account flows.
 *
 * Deliberately free of `cloudflare:workers`, `astro:*` and any project import,
 * so the small decisions made while choosing an account type can be unit tested
 * under plain Node (see test/roles.test.mts).
 *
 * This is presentation/UX vocabulary only. It never grants a role: the server
 * is the sole authority (see /api/auth/register and the owner/admin guards in
 * src/lib/server/auth.ts). `selectableRole` exists so a URL such as
 * `?role=admin` is treated as "no role chosen" instead of being forwarded.
 */

export const USER_ROLES = ['student', 'owner'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const isUserRole = (value: unknown): value is UserRole =>
  typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);

/**
 * The role explicitly chosen on the account screen, or null.
 *
 * Anything that is not exactly `student` or `owner` — including a hostile
 * `?role=admin` — resolves to null, which makes the UI fall back to asking the
 * question again rather than silently defaulting.
 */
export const selectableRole = (value: unknown): UserRole | null =>
  isUserRole(value) ? value : null;

/** Human label for the chosen account type. */
export const roleLabel = (role: UserRole): string =>
  role === 'owner' ? 'PG Owner' : 'Student';

/** Where an account of this role belongs after authentication. */
export const roleLanding = (role: UserRole): string => (role === 'owner' ? '/owner' : '/');

/**
 * True when the account that just authenticated is not the type the user
 * selected on the login screen.
 *
 * Admins are exempt: an admin may legitimately enter through either door and
 * already holds every permission, so there is nothing to reconcile. A mismatch
 * is never a permission grant — it is only a prompt to explain the correct
 * next step.
 */
export const isRoleMismatch = (
  selected: UserRole | null,
  actual: UserRole,
  isAdmin: boolean
): boolean => selected !== null && !isAdmin && actual !== selected;
