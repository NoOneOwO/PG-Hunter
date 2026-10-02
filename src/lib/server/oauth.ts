/**
 * PG Hunter — Google OAuth (manual flow on Cloudflare Workers).
 *
 * Supabase-style hosted auth is gone; the Worker performs the OAuth 2.0
 * authorization-code dance directly with Google using the fetch primitives
 * available in workerd.
 *
 * Secrets: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (wrangler secrets in
 * production, .dev.vars locally). See CLOUDFLARE_SETUP.md.
 */

import { env } from 'cloudflare:workers';
import type { APIContext } from 'astro';
import { getRequestUrl, getSiteUrl, randomHex, safePath, timingSafeEqual } from './auth';

export const OAUTH_STATE_COOKIE = 'ph_oauth_state';
export const OAUTH_NEXT_COOKIE = 'ph_oauth_next';
export const OAUTH_ROLE_COOKIE = 'ph_oauth_role';

export const isOAuthConfigured = (): boolean =>
  Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export const googleAuthUrl = (context: APIContext): string | null => {
  if (!isOAuthConfigured()) return null;

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${getSiteUrl(context)}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state: randomHex(16),
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

/** Exchange the authorization code for tokens, then fetch the user's profile. */
export const exchangeGoogleCode = async (
  context: APIContext,
  code: string
): Promise<{ email: string; name: string; picture: string | null } | null> => {
  if (!isOAuthConfigured()) return null;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${getSiteUrl(context)}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const tokenData = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
  if (!tokenRes.ok || !tokenData.access_token) return null;

  const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const info = (await infoRes.json().catch(() => ({}))) as {
    email?: string;
    name?: string;
    picture?: string;
  };
  if (!infoRes.ok || !info.email) return null;

  return {
    email: info.email.toLowerCase(),
    name: info.name?.trim() || info.email.split('@')[0] || 'User',
    picture: info.picture ?? null,
  };
};

/** The `next` destination captured before the OAuth redirect. */
export const popOAuthNext = (context: APIContext): string => {
  const next = context.cookies.get(OAUTH_NEXT_COOKIE)?.value ?? '/';
  context.cookies.delete(OAUTH_NEXT_COOKIE, { path: '/' });
  return safePath(next);
};

/** Validate the `state` param against the cookie we set before redirecting. */
export const verifyOAuthState = (context: APIContext, state: string | null): boolean => {
  const expected = context.cookies.get(OAUTH_STATE_COOKIE)?.value;
  context.cookies.delete(OAUTH_STATE_COOKIE, { path: '/' });
  if (!expected || !state) return false;
  return timingSafeEqual(state, expected);
};

/** Role requested via Google sign-in (?role=owner). Validated server-side. */
export const popOAuthRole = (context: APIContext): 'owner' | 'student' => {
  const raw = context.cookies.get(OAUTH_ROLE_COOKIE)?.value;
  context.cookies.delete(OAUTH_ROLE_COOKIE, { path: '/' });
  return raw === 'owner' ? 'owner' : 'student';
};

/** Convenience for the callback: parse the full query string reliably. */
export const oauthCallbackParams = (context: APIContext): URLSearchParams =>
  getRequestUrl(context).searchParams;
