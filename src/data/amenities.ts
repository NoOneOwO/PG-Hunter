/**
 * Amenity catalog — slug + human label.
 *
 * Real data, not a placeholder: owners pick from this list on the listing form
 * and it is the display vocabulary for amenity chips on every card and detail
 * page. `owner_listings.amenity_slugs` stores the slugs.
 */

export interface Amenity {
  slug: string;
  label: string;
}

export const amenities: Amenity[] = [
  { slug: 'wifi', label: 'High-speed WiFi' },
  { slug: 'food', label: 'Food / Mess' },
  { slug: 'laundry', label: 'Laundry' },
  { slug: 'housekeeping', label: 'Housekeeping' },
  { slug: 'ac', label: 'AC' },
  { slug: 'geyser', label: 'Geyser' },
  { slug: 'power-backup', label: 'Power backup' },
  { slug: 'cctv', label: 'CCTV' },
  { slug: 'security', label: 'Security guard' },
  { slug: 'parking', label: 'Parking' },
  { slug: 'gym', label: 'Gym' },
  { slug: 'tv', label: 'TV' },
  { slug: 'refrigerator', label: 'Fridge' },
  { slug: 'study-table', label: 'Study table' },
  { slug: 'wardrobe', label: 'Wardrobe' },
  { slug: 'balcony', label: 'Balcony' },
  { slug: 'attached-bath', label: 'Attached bathroom' },
  { slug: 'water-filter', label: 'Water filter' },
  { slug: 'lift', label: 'Lift' },
  { slug: 'washing-machine', label: 'Washing machine' },
];

export const amenityBySlug = (slug: string): Amenity | undefined =>
  amenities.find((a) => a.slug === slug);
