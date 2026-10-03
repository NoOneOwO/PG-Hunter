/**
 * PG Hunter — Google OAuth error codes.
 *
 * Deliberately dependency-free (no `cloudflare:workers` import) so it can be
 * unit tested under plain Node — see test/oauth.test.mts. The mapping is
 * security-relevant: its result is interpolated into the `location` header of
 * /api/auth/google/callback, so it must always resolve to a known constant and
 * never reflect Google's (attacker-influenceable) input back to the browser.
 */

/** Codes the login page knows how to explain. Keep in sync with login.astro. */
export type GoogleLoginErrorCode =
  | 'google-denied'
  | 'google-redirect-mismatch'
  | 'google-failed';

/**
 * Map Google's `error` query param to the code the login page renders.
 *
 * `redirect_uri_mismatch` is surfaced separately because it is a configuration
 * problem (the callback is not registered on the OAuth client), not something
 * the visitor did — see CLOUDFLARE_SETUP.md §2. Reporting it as "cancelled", as
 * this previously did, made the setup nearly impossible to diagnose from the UI.
 */
export const googleErrorToCode = (error: string | null): GoogleLoginErrorCode => {
  switch (error) {
    case 'access_denied':
      return 'google-denied';
    case 'redirect_uri_mismatch':
      return 'google-redirect-mismatch';
    default:
      return 'google-failed';
  }
};
