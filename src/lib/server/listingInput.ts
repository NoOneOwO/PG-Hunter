/**
 * PG Hunter — pure parsing of a listing create/update payload.
 *
 * Shared by POST /api/owner/listings (an owner creating their own PG) and
 * POST /api/admin/listings (the team setting a page up on an owner's behalf),
 * so both paths validate identically. Deliberately free of `cloudflare:workers`
 * so it can be unit tested under plain Node — see test/listingInput.test.mts.
 */

export interface ParsedRoom {
  roomType: string;
  occupancy: string;
  rent: number;
  deposit: number;
  available: number;
}

export interface ParsedListingPayload {
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
  food: { available: boolean; type?: string; monthlyCost?: number };
  amenitySlugs: string[];
  rooms: ParsedRoom[];
  /**
   * Photos uploaded before the listing existed (uploads land unattached and are
   * claimed on save). Only the *caller's own* unattached media can be claimed,
   * which is enforced by the route, not here.
   */
  pendingMediaIds: string[];
}

export type ListingPayloadResult =
  | { ok: true; value: ParsedListingPayload }
  | { ok: false; error: string };

/** Cap on rooms per listing: keeps one request from writing an unbounded batch. */
export const MAX_ROOMS = 50;

/** Cap on photos claimed in a single create. */
export const MAX_PENDING_MEDIA = 30;

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v.trim() : fallback);
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : [];
const idArr = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()))]
    : [];

/**
 * Parse and validate a create payload.
 *
 * Two rules the product depends on: a PG must have a name, and it must have at
 * least one room with a real rent (rent is what students compare, so a listing
 * without one is not a listing yet).
 */
export const parseListingPayload = (body: any): ListingPayloadResult => {
  const name = str(body?.name);
  if (!name) return { ok: false, error: 'Please enter a name for the PG.' };
  if (name.length > 120) return { ok: false, error: 'Keep the PG name under 120 characters.' };

  const roomsRaw = Array.isArray(body?.rooms) ? body.rooms : [];
  if (roomsRaw.length === 0) return { ok: false, error: 'Add at least one room with rent.' };
  if (roomsRaw.length > MAX_ROOMS) {
    return { ok: false, error: `That is more than ${MAX_ROOMS} rooms — split the property instead.` };
  }

  const rooms: ParsedRoom[] = roomsRaw.map((r: any) => ({
    roomType: str(r?.roomType, 'double'),
    occupancy: str(r?.occupancy, 'Sharing'),
    rent: typeof r?.rent === 'number' ? r.rent : NaN,
    deposit: typeof r?.deposit === 'number' ? r.deposit : 0,
    available: r?.available === undefined ? 1 : r.available ? 1 : 0,
  }));
  if (rooms.some((r) => !Number.isFinite(r.rent) || r.rent < 0)) {
    return { ok: false, error: 'Each room needs a valid monthly rent.' };
  }

  const food =
    body?.food && typeof body.food === 'object'
      ? {
          available: Boolean(body.food.available),
          type: str(body.food.type) || undefined,
          monthlyCost: typeof body.food.monthlyCost === 'number' ? body.food.monthlyCost : undefined,
        }
      : { available: false };

  return {
    ok: true,
    value: {
      name,
      propertyType: str(body?.propertyType, 'pg'),
      gender: str(body?.gender, 'co-ed'),
      address: str(body?.address),
      locality: str(body?.locality),
      city: str(body?.city, 'Delhi'),
      latitude: num(body?.latitude),
      longitude: num(body?.longitude),
      description: str(body?.description),
      rules: strArr(body?.rules),
      curfew: str(body?.curfew) || null,
      food,
      amenitySlugs: strArr(body?.amenitySlugs),
      rooms,
      pendingMediaIds: idArr(body?.pendingMediaIds).slice(0, MAX_PENDING_MEDIA),
    },
  };
};
