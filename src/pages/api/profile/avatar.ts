import type { APIContext } from 'astro';
import { currentUser, getDb, json, nowIso, publicUser } from '@/lib/server/auth';
import { deleteObject, getObject, storeObject } from '@/lib/server/media';

export const prerender = false;

/** Avatars are shown at small sizes across the app, so the cap is tighter than
 *  the 10 MB listing-image limit and animated formats are excluded. */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const ALLOWED_AVATAR_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Trust the bytes, not the declared Content-Type.
 *
 * We hand our own content type back to the browser from /api/media/*, so a
 * mislabelled upload would be served as an image while really being something
 * else. Cheap magic-byte check closes that off.
 */
const sniffImage = (bytes: Uint8Array): string | null => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  if (isPng) return 'png';
  const isRiff =
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;
  return isRiff ? 'webp' : null;
};

/**
 * Best-effort cleanup of a previous avatar. Never fails the request.
 *
 * Only R2 keys are ours to delete: a Google account's picture is an absolute
 * https URL on Google's CDN, and passing that to the bucket would just look up
 * a key that does not exist. (`avatar_url` may hold either form — see
 * `avatarUrl()` in lib/server/auth.ts.)
 */
const dropPrevious = async (previousKey: string | null): Promise<void> => {
  if (!previousKey || /^https?:\/\//i.test(previousKey)) return;
  try {
    if (await getObject(previousKey)) await deleteObject(previousKey);
  } catch {
    // A stale object costs storage, not correctness.
  }
};

export async function POST(context: APIContext) {
  const user = await currentUser(context);
  if (!user) return json({ error: 'Not logged in.' }, 401);

  const form = await context.request.formData().catch(() => null);
  if (!form) return json({ error: 'Expected multipart form data.' }, 400);

  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'Missing "file" field.' }, 400);
  if (file.size === 0) return json({ error: 'That image is empty.' }, 400);
  if (file.size > MAX_AVATAR_BYTES) {
    return json({ error: 'That image is too large (max 5 MB).' }, 400);
  }

  const declaredExt = ALLOWED_AVATAR_TYPES[file.type];
  if (!declaredExt) {
    return json({ error: 'Use a JPEG, PNG or WebP image.' }, 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffedExt = sniffImage(bytes);
  if (!sniffedExt) {
    return json({ error: 'That file is not a readable JPEG, PNG or WebP image.' }, 400);
  }

  // Downloading a Google picture and re-uploading it here would be a sync job
  // of its own; the uploaded file simply wins and the CDN URL is dropped.
  const key = await storeObject(
    `avatars/${user.id}`,
    `avatar.${sniffedExt}`,
    `image/${sniffedExt === 'jpg' ? 'jpeg' : sniffedExt}`,
    bytes.buffer as ArrayBuffer
  );

  const updatedAt = nowIso();
  await getDb()
    .prepare('UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?')
    .bind(key, updatedAt, user.id)
    .run();

  await dropPrevious(user.avatar_url);

  return json({ user: publicUser({ ...user, avatar_url: key, updated_at: updatedAt }) });
}

/** Drop back to initials. */
export async function DELETE(context: APIContext) {
  const user = await currentUser(context);
  if (!user) return json({ error: 'Not logged in.' }, 401);
  if (!user.avatar_url) return json({ user: publicUser(user) });

  const updatedAt = nowIso();
  await getDb()
    .prepare('UPDATE users SET avatar_url = NULL, updated_at = ? WHERE id = ?')
    .bind(updatedAt, user.id)
    .run();

  await dropPrevious(user.avatar_url);

  return json({ user: publicUser({ ...user, avatar_url: null, updated_at: updatedAt }) });
}