/**
 * PG Hunter — shared reference types.
 *
 * Listings are NOT modelled here: every real listing lives in Cloudflare D1
 * and is serialized by `src/lib/server/listings.ts`. What remains in this
 * module is the reference vocabulary the UI and the badge component share.
 */

/**
 * Verification tiers, in the order a listing climbs them.
 *
 * D1 stores `unverified` for a listing with no live claim; the badge component
 * maps that to `listed` so both worlds speak one vocabulary.
 */
export type VerificationStatus =
  | 'listed'
  | 'pg_hunter_verified'
  | 'rishabh_irl_verified';

/**
 * A college students can search and browse by.
 *
 * Reference data, not user content: it powers the search autocomplete, the
 * college landing pages and the profile picker. PGs are matched to a college
 * by the locality/keyword search of `/api/listings`, so no listing carries a
 * foreign key into this list.
 */
export interface College {
  id: string;
  name: string;
  shortName: string;
  slug: string;
  city: string;
  locality: string;
  latitude: number;
  longitude: number;
}

/** A Delhi locality students browse by. Matched against a listing's free-text `locality`. */
export interface Locality {
  id: string;
  name: string;
  slug: string;
  city: string;
}
