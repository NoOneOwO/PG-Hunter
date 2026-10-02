/**
 * PG Hunter — owner listing serialization helpers (shared by owner, admin
 * and public API routes).
 */

import { effectiveVerificationStatus, isExpired } from '../verificationRules';

/** Raw row from the owner_listings table. */
export interface ListingRow {
  id: string;
  owner_id: string;
  name: string;
  property_type: string;
  gender: string;
  address: string;
  locality: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  description: string;
  rules: string; // JSON string[]
  curfew: string | null;
  food: string; // JSON object
  amenity_slugs: string; // JSON string[]
  status: 'draft' | 'pending' | 'active' | 'rejected';
  verification_status: 'unverified' | 'pg_hunter_verified' | 'rishabh_irl_verified';
  rejection_reason: string | null;
  // Denormalised verification cache, written only by lib/server/verification.ts
  // (migration 0006). Never assign these outside that module.
  verified_at?: string | null;
  verified_by?: string | null;
  verification_method?: string | null;
  verification_evidence?: string | null;
  verification_expires_at?: string | null;
  // Plan window, written only by lib/server/listingPlans.ts.
  plan?: 'basic' | 'verified';
  plan_started_at?: string | null;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoomRow {
  id: number;
  room_type: string;
  occupancy: string;
  rent: number;
  deposit: number;
  available: number;
}

export interface MediaRow {
  id: string;
  listing_id: string | null;
  type: 'photo' | 'video' | 'document';
  provider: 'r2' | 'youtube' | 'unsplash';
  external_id: string;
  title: string;
  sort_order: number;
  uploaded_by: string | null;
  created_at: string;
}

export const parseJson = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

/** The serialized listing shape returned by the API. */
export interface ListingDto {
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
  status: ListingRow['status'];
  verificationStatus: ListingRow['verification_status'];
  /**
   * Whether the claim is still live. An expired verification is reported as
   * 'unverified' by `listingDto`, so a lapsed badge disappears on its own
   * rather than being displayed until somebody remembers to revoke it.
   */
  verificationExpiresAt: string | null;
  plan: 'basic' | 'verified';
  expiresAt: string | null;
  isExpired: boolean;
  rejectionReason: string | null;
  rooms: {
    id: number;
    roomType: string;
    occupancy: string;
    rent: number;
    deposit: number;
    available: boolean;
  }[];
  media: {
    id: string;
    type: MediaRow['type'];
    provider: MediaRow['provider'];
    externalId: string;
    url: string | null;
    title: string;
  }[];
  createdAt: string;
  updatedAt: string;
}

const roomDto = (r: RoomRow) => ({
  id: r.id,
  roomType: r.room_type,
  occupancy: r.occupancy,
  rent: r.rent,
  deposit: r.deposit,
  available: Boolean(r.available),
});

/** Serialize a listing row + children into the API shape. */
export const listingDto = (
  row: ListingRow,
  rooms: RoomRow[],
  media: MediaRow[],
  mediaUrlFor: (key: string) => string
): ListingDto => ({
  id: row.id,
  ownerId: row.owner_id,
  name: row.name,
  propertyType: row.property_type,
  gender: row.gender,
  address: row.address,
  locality: row.locality,
  city: row.city,
  latitude: row.latitude,
  longitude: row.longitude,
  description: row.description,
  rules: parseJson<string[]>(row.rules, []),
  curfew: row.curfew,
  food: parseJson<{ available: boolean; type?: 'veg' | 'non-veg' | 'both'; monthlyCost?: number }>(row.food, {
    available: false,
  }),
  amenitySlugs: parseJson<string[]>(row.amenity_slugs, []),
  status: row.status,
  // Downgrade a lapsed claim on the way out rather than trusting the stored
  // column: the cache cannot be relied on to be swept the moment it expires.
  verificationStatus: effectiveVerificationStatus({
    verification_status: row.verification_status,
    verification_expires_at: row.verification_expires_at ?? null,
  }),
  // ^ see below: helper returns 'unverified' for a lapsed or absent claim.
  verificationExpiresAt: row.verification_expires_at ?? null,
  plan: row.plan === 'verified' ? 'verified' : 'basic',
  expiresAt: row.expires_at ?? null,
  isExpired: isExpired({ expires_at: row.expires_at ?? null }),
  rejectionReason: row.rejection_reason,
  rooms: rooms.map(roomDto),
  media: media.map((m) => ({
    id: m.id,
    type: m.type,
    provider: m.provider,
    externalId: m.external_id,
    url: m.provider === 'r2' ? mediaUrlFor(m.external_id) : null,
    title: m.title,
  })),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Fetch one listing with its rooms + media, or null. */
export const fetchListing = async (
  db: D1Database,
  id: string
): Promise<{ row: ListingRow; rooms: RoomRow[]; media: MediaRow[] } | null> => {
  const row = await db.prepare('SELECT * FROM owner_listings WHERE id = ?').bind(id).first<ListingRow>();
  if (!row) return null;
  const roomsRes = await db
    .prepare('SELECT * FROM listing_rooms WHERE listing_id = ? ORDER BY id')
    .bind(id)
    .all<RoomRow>();
  const mediaRes = await db
    .prepare('SELECT * FROM media WHERE listing_id = ? ORDER BY sort_order, created_at')
    .bind(id)
    .all<MediaRow>();
  return { row, rooms: roomsRes.results, media: mediaRes.results };
};

/**
 * Columns a public listing read needs.
 *
 * Explicit rather than `SELECT *` so that adding a private column to
 * `owner_listings` later cannot leak it into a public response by accident.
 */
export const PUBLIC_LISTING_COLUMNS = [
  'id',
  'owner_id',
  'name',
  'property_type',
  'gender',
  'address',
  'locality',
  'city',
  'latitude',
  'longitude',
  'description',
  'rules',
  'curfew',
  'food',
  'amenity_slugs',
  'status',
  'verification_status',
  'rejection_reason',
  'verified_at',
  'verification_expires_at',
  'plan',
  'plan_started_at',
  'expires_at',
  'created_at',
  'updated_at',
].join(', ');

/**
 * Fetch rooms and media for many listings in two queries.
 *
 * The public listing endpoint used to call `fetchListing` once per row, which
 * is a textbook N+1: one query per listing for rooms and another for media.
 * With pagination now in place it is bounded, but it is still 2N+1 round
 * trips where 3 will do. IDs are interpolated as `?` placeholders, never
 * concatenated.
 */
export const fetchListingChildrenBatch = async (
  db: D1Database,
  ids: string[]
): Promise<{ rooms: Map<string, RoomRow[]>; media: Map<string, MediaRow[]> }> => {
  const rooms = new Map<string, RoomRow[]>();
  const media = new Map<string, MediaRow[]>();
  if (ids.length === 0) return { rooms, media };

  const placeholders = ids.map(() => '?').join(', ');
  const [roomsRes, mediaRes] = await Promise.all([
    db
      .prepare(`SELECT * FROM listing_rooms WHERE listing_id IN (${placeholders}) ORDER BY id`)
      .bind(...ids)
      .all<RoomRow & { listing_id: string }>(),
    db
      .prepare(
        `SELECT * FROM media WHERE listing_id IN (${placeholders}) ORDER BY sort_order, created_at`
      )
      .bind(...ids)
      .all<MediaRow>(),
  ]);

  for (const room of roomsRes.results) {
    const bucket = rooms.get(room.listing_id) ?? [];
    bucket.push(room);
    rooms.set(room.listing_id, bucket);
  }
  for (const item of mediaRes.results) {
    if (!item.listing_id) continue;
    const bucket = media.get(item.listing_id) ?? [];
    bucket.push(item);
    media.set(item.listing_id, bucket);
  }
  return { rooms, media };
};
