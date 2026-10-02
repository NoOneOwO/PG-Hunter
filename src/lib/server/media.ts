/**
 * PG Hunter — R2 media helpers (owner-uploaded images + documents).
 *
 * Files live in an R2 bucket (MEDIA binding). Object keys are namespaced:
 *   owners/{ownerId}/listing-images/{uuid}.{ext}
 *   owners/{ownerId}/listing-documents/{uuid}.{ext}
 *   verification/{ownerId}/{uuid}.{ext}   ← private, never served publicly
 *
 * Videos are YouTube ids stored in the `media` table (MVP per the
 * architecture docs) — raw video upload needs Cloudflare Stream (deferred).
 */

import { env } from 'cloudflare:workers';

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const ALLOWED_DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

export type MediaPurpose = 'listing-images' | 'listing-documents' | 'verification';

export const isMediaPurpose = (v: string): v is MediaPurpose =>
  v === 'listing-images' || v === 'listing-documents' || v === 'verification';

/** Map an upload purpose to the media table `type`. */
export const purposeToType = (purpose: MediaPurpose): 'photo' | 'document' =>
  purpose === 'listing-images' ? 'photo' : 'document';

const extOf = (fileName: string, fallback = 'bin'): string => {
  const m = /\.([a-zA-Z0-9]{1,8})$/.exec(fileName);
  return m ? m[1].toLowerCase() : fallback;
};

/** Store bytes in R2 under a namespaced key; returns the object key. */
export const storeObject = async (
  folder: string,
  fileName: string,
  contentType: string,
  data: ArrayBuffer
): Promise<string> => {
  const key = `${folder}/${crypto.randomUUID()}.${extOf(fileName)}`;
  await env.MEDIA.put(key, data, {
    httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
  });
  return key;
};

export const getObject = (key: string): Promise<R2ObjectBody | null> => env.MEDIA.get(key);

export const deleteObject = async (key: string): Promise<void> => {
  await env.MEDIA.delete(key);
};

/** Browser URL that streams an object back through the Worker. */
export const mediaUrl = (key: string): string => `/api/media/${key}`;

/** Validate size + content type; returns an error message or null. */
export const validateFile = (file: File, allowed: string[]): string | null => {
  if (file.size === 0) return 'The file is empty.';
  if (file.size > MAX_FILE_BYTES) return 'The file is too large (max 10 MB).';
  if (!allowed.includes(file.type)) return 'This file type is not allowed.';
  return null;
};
