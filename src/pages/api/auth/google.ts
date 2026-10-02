import type { APIContext } from 'astro';
import { isSecureRequest, safePath } from '@/lib/server/auth';
import { OAUTH_NEXT_COOKIE, OAUTH_ROLE_COOKIE, OAUTH_STATE_COOKIE, googleAuthUrl } from '@/lib/server/oauth';

export const prerender = false;

export async function GET(context: APIContext) {
  const url = new URL(context.request.url);
  const next = safePath(url.searchParams.get('next'));
  const requestedRole = url.searchParams.get('role') === 'owner' ? 'owner' : 'student';

  const authUrl = googleAuthUrl(context);
  if (!authUrl) {
    return context.redirect('/login?error=google-not-configured');
  }

  const state = new URL(authUrl).searchParams.get('state') ?? '';
  const oauthOpts = {
    httpOnly: true,
    secure: isSecureRequest(context),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 600,
  };
  context.cookies.set(OAUTH_STATE_COOKIE, state, oauthOpts);
  context.cookies.set(OAUTH_NEXT_COOKIE, next, oauthOpts);
  // Persist requested role so new Google users can be created as owner when they came via /login?role=owner
  // Existing users keep their stored role — this is only for new accounts.
  context.cookies.set(OAUTH_ROLE_COOKIE, requestedRole, oauthOpts);

  return context.redirect(authUrl);
}
