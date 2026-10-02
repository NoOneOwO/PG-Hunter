/**
 * PG Hunter — core data types.
 * Mirrors the entity model documented in /ai/DATABASE_SCHEMA.md so that the
 * Phase 1 static/mock layer can later be replaced by Cloudflare D1 + Workers
 * without reshaping the UI.
 *
 * NOTE: All data in /src/data is MOCK data for development.
 */

export type VerificationStatus =
  | 'listed'
  | 'pg_hunter_verified'
  | 'rishabh_irl_verified';

export type PropertyType = 'pg' | 'co-living' | 'flat';

export type Gender = 'boys' | 'girls' | 'co-ed';

export type RoomType = 'single' | 'double' | 'triple' | 'four-plus';

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

export interface Locality {
  id: string;
  name: string;
  slug: string;
  city: string;
}

export interface Room {
  id: string;
  roomType: RoomType;
  occupancy: string;
  /** Monthly rent in INR. Rents live at the room level. */
  rent: number;
  /** One-time security deposit in INR. */
  deposit: number;
  available: boolean;
}

export type MediaType = 'video' | 'photo';

export interface PropertyMedia {
  id: string;
  type: MediaType;
  /** For video: 'youtube'. For photo: 'unsplash' during mock phase. */
  provider: 'youtube' | 'unsplash';
  /** YouTube video ID for videos, image URL for photos. */
  externalId: string;
  title: string;
  sortOrder: number;
}

export interface CollegeDistance {
  collegeId: string;
  /** Straight-line or stated distance in metres. */
  distanceMeters: number;
}

export interface Property {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  propertyType: PropertyType;
  gender: Gender;
  address: string;
  localityId: string;
  latitude: number;
  longitude: number;
  description: string;
  verificationStatus: VerificationStatus;
  status: 'active' | 'pending' | 'inactive';
  /** Null until real, attributable reviews exist. */
  rating: number | null;
  reviewCount: number;
  rooms: Room[];
  amenitySlugs: string[];
  collegeDistances: CollegeDistance[];
  media: PropertyMedia[];
  food: { available: boolean; type?: 'veg' | 'non-veg' | 'both'; monthlyCost?: number };
  curfew?: string;
  rules: string[];
  /** If true, this property is a mock placeholder for development. */
  isMock: true;
}
