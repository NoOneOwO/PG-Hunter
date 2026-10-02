/**
 * PG Hunter — owner listing serialization helpers (shared by owner, admin
 * and public API routes).
 */

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
  verificationStatus: row.verification_status,
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
