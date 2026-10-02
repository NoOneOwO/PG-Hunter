import type { APIContext } from 'astro';
import { currentUser, getDb } from '@/lib/server/auth';
import { getObject } from '@/lib/server/media';

export const prerender = false;

/**
 * Stream an R2 object back to the browser.
 * Listing images/documents are public; verification documents are private
 * (only the submitting owner or an admin may view them).
 */
export async function GET(context: APIContext) {
  const key = Array.isArray(context.params.key)
    ? context.params.key.join('/')
    : (context.params.key ?? '');
  if (!key) return new Response('Not found', { status: 404 });

  if (key.startsWith('verification/')) {
    const doc = await getDb()
      .prepare('SELECT owner_id FROM verification_documents WHERE file_key = ?')
      .bind(key)
      .first<{ owner_id: string }>();
    if (!doc) return new Response('Not found', { status: 404 });
    const user = await currentUser(context);
    if (!user || (user.id !== doc.owner_id && !user.is_admin)) {
      return new Response('Forbidden', { status: 403 });
    }
  }

  const object = await getObject(key);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=86400');
  return new Response(object.body, { headers });
}
