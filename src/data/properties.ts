import type { Property, PropertyMedia } from './types';

/**
 * MOCK DATA — development placeholder only. Replaced by Cloudflare D1 + admin
 * workflow in Phase 2. Do NOT treat these as live listings.
 *
 * Rules applied from /ai:
 * - No fabricated reviews/ratings (rating stays null, reviewCount 0).
 * - Rents live at the room level; cards show the "starting from" price.
 * - YouTube IDs are generic placeholder clips, clearly not real walkthroughs.
 */

export const properties: Property[] = [
  {
    id: 'prop_sunrise_rohini',
    ownerId: 'own_mock_01',
    name: 'Sunrise Boys PG',
    slug: 'sunrise-boys-pg-rohini',
    propertyType: 'pg',
    gender: 'boys',
    address: 'C-9/56, Sector 7, Rohini, Delhi',
    localityId: 'loc_rohini',
    latitude: 28.7166,
    longitude: 77.1109,
    description:
      'Clean, spacious rooms near Rohini Sector 7 with regular housekeeping, fresh mess food and reliable power backup. Popular with DTU students.',
    verificationStatus: 'rishabh_irl_verified',
    status: 'active',
    rating: null,
    reviewCount: 0,
    rooms: [
      { id: 'rm_sunrise_1', roomType: 'single', occupancy: 'Single sharing', rent: 18000, deposit: 18000, available: true },
      { id: 'rm_sunrise_2', roomType: 'double', occupancy: 'Double sharing', rent: 13000, deposit: 13000, available: true },
      { id: 'rm_sunrise_3', roomType: 'triple', occupancy: 'Triple sharing', rent: 10500, deposit: 10500, available: false },
    ],
    amenitySlugs: ['wifi', 'food', 'laundry', 'housekeeping', 'ac', 'power-backup', 'cctv', 'security', 'study-table', 'geyser'],
    collegeDistances: [{ collegeId: 'col_dtu', distanceMeters: 2100 }],
    media: [
      { id: 'med_sunrise_1', type: 'photo', provider: 'unsplash', externalId: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=70', title: 'Common living area', sortOrder: 1 },
      { id: 'med_sunrise_2', type: 'photo', provider: 'unsplash', externalId: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=800&q=70', title: 'Bedroom', sortOrder: 2 },
      { id: 'med_sunrise_3', type: 'video', provider: 'youtube', externalId: 'aqz-KE-bpKQ', title: 'Mock room walkthrough (placeholder clip)', sortOrder: 3 },
    ],
    food: { available: true, type: 'both', monthlyCost: 3500 },
    curfew: '12:30 AM',
    rules: ['No smoking inside rooms', 'Visitor entry till 10 PM', 'Quiet hours 10 PM - 7 AM'],
    isMock: true,
  },
  {
    id: 'prop_green_meadow',
    ownerId: 'own_mock_02',
    name: 'Green Meadow Boys PG',
    slug: 'green-meadow-boys-pg-rohini',
    propertyType: 'pg',
    gender: 'boys',
    address: 'H-15, Prashant Vihar, Rohini, Delhi',
    localityId: 'loc_rohini',
    latitude: 28.7148,
    longitude: 77.1012,
    description:
      'Budget-friendly PG with attached bathrooms and a garden courtyard. 5 minutes from Rohini East metro.',
    verificationStatus: 'listed',
    status: 'active',
    rating: null,
    reviewCount: 0,
    rooms: [
      { id: 'rm_gm_1', roomType: 'double', occupancy: 'Double sharing', rent: 11000, deposit: 11000, available: true },
      { id: 'rm_gm_2', roomType: 'triple', occupancy: 'Triple sharing', rent: 8500, deposit: 8500, available: true },
    ],
    amenitySlugs: ['wifi', 'food', 'attached-bath', 'geyser', 'study-table', 'wardrobe', 'cctv'],
    collegeDistances: [{ collegeId: 'col_dtu', distanceMeters: 3400 }],
    media: [
      { id: 'med_gm_1', type: 'photo', provider: 'unsplash', externalId: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70', title: 'Bedroom', sortOrder: 1 },
      { id: 'med_gm_2', type: 'video', provider: 'youtube', externalId: 'jNQXAC9IVRw', title: 'Mock walkthrough (placeholder clip)', sortOrder: 2 },
    ],
    food: { available: true, type: 'veg', monthlyCost: 2800 },
    curfew: '11:30 PM',
    rules: ['Vegetarian mess only', 'No outsiders after 9:30 PM'],
    isMock: true,
  },
  {
    id: 'prop_aura_girls',
    ownerId: 'own_mock_03',
    name: 'Aura Girls PG',
    slug: 'aura-girls-pg-dwarka',
    propertyType: 'pg',
    gender: 'girls',
    address: 'Plot 22, Sector 12, Dwarka, Delhi',
    localityId: 'loc_dwarka',
    latitude: 28.5961,
    longitude: 77.0383,
    description:
      'A secure, women-only PG with CCTV, women security staff and a separate study floor. Close to NSUT and IPU.',
    verificationStatus: 'pg_hunter_verified',
    status: 'active',
    rating: null,
    reviewCount: 0,
    rooms: [
      { id: 'rm_aura_1', roomType: 'single', occupancy: 'Single sharing', rent: 20000, deposit: 20000, available: true },
      { id: 'rm_aura_2', roomType: 'double', occupancy: 'Double sharing', rent: 14000, deposit: 14000, available: true },
    ],
    amenitySlugs: ['wifi', 'food', 'cctv', 'security', 'housekeeping', 'ac', 'geyser', 'laundry', 'study-table', 'water-filter'],
    collegeDistances: [
      { collegeId: 'col_nsut', distanceMeters: 1200 },
      { collegeId: 'col_ipu', distanceMeters: 2900 },
    ],
    media: [
      { id: 'med_aura_1', type: 'photo', provider: 'unsplash', externalId: 'https://images.unsplash.com/photo-1554995207-c18c203602cb?auto=format&fit=crop&w=800&q=70', title: 'Room', sortOrder: 1 },
      { id: 'med_aura_2', type: 'video', provider: 'youtube', externalId: 'aqz-KE-bpKQ', title: 'Mock walkthrough (placeholder clip)', sortOrder: 2 },
    ],
    food: { available: true, type: 'both', monthlyCost: 3200 },
    curfew: '10:30 PM',
    rules: ['Girls only', 'Curfew 10:30 PM on weekdays'],
    isMock: true,
  },
  {
    id: 'prop_nest_dwarka',
    ownerId: 'own_mock_04',
    name: 'Nest Co-living Dwarka',
    slug: 'nest-co-living-dwarka',
    propertyType: 'co-living',
    gender: 'co-ed',
    address: 'Tower B, Sector 19, Dwarka, Delhi',
    localityId: 'loc_dwarka',
    latitude: 28.5891,
    longitude: 77.0393,
    description:
      'Fully furnished co-living with community events, common lounge, and flexible leases. Mixed-gender floors with secure access.',
    verificationStatus: 'listed',
    status: 'active',
    rating: null,
    reviewCount: 0,
    rooms: [
      { id: 'rm_nest_1', roomType: 'single', occupancy: 'Private room', rent: 22000, deposit: 22000, available: true },
      { id: 'rm_nest_2', roomType: 'double', occupancy: 'Double sharing', rent: 15000, deposit: 15000, available: true },
    ],
    amenitySlugs: ['wifi', 'food', 'gym', 'tv', 'housekeeping', 'ac', 'lift', 'cctv', 'laundry', 'refrigerator'],
    collegeDistances: [
      { collegeId: 'col_ipu', distanceMeters: 1500 },
      { collegeId: 'col_nsut', distanceMeters: 2800 },
    ],
    media: [
      { id: 'med_nest_1', type: 'photo', provider: 'unsplash', externalId: 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=800&q=70', title: 'Lounge', sortOrder: 1 },
      { id: 'med_nest_2', type: 'photo', provider: 'unsplash', externalId: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70', title: 'Kitchen', sortOrder: 2 },
      { id: 'med_nest_3', type: 'video', provider: 'youtube', externalId: 'jNQXAC9IVRw', title: 'Mock tour (placeholder clip)', sortOrder: 3 },
    ],
    food: { available: true, type: 'both', monthlyCost: 4000 },
    curfew: undefined,
    rules: ['Community quiet hours 11 PM - 7 AM', 'Shared spaces open till midnight'],
    isMock: true,
  },
  {
    id: 'prop_hauz_flats',
    ownerId: 'own_mock_05',
    name: 'Hauz Khas Student Flats',
    slug: 'hauz-khas-student-flats',
    propertyType: 'flat',
    gender: 'co-ed',
    address: 'Aurobindo Marg, Hauz Khas, Delhi',
    localityId: 'loc_hauz_khas',
    latitude: 28.5505,
    longitude: 77.2012,
    description:
      '3BHK flats for student groups near IIT Delhi. Full kitchen, large rooms, metro 8 minutes away.',
    verificationStatus: 'listed',
    status: 'active',
    rating: null,
    reviewCount: 0,
    rooms: [
      { id: 'rm_hf_1', roomType: 'double', occupancy: 'Double sharing', rent: 16000, deposit: 32000, available: true },
      { id: 'rm_hf_2', roomType: 'triple', occupancy: 'Triple sharing', rent: 11500, deposit: 23000, available: true },
    ],
    amenitySlugs: ['wifi', 'refrigerator', 'balcony', 'parking', 'geyser', 'washing-machine', 'study-table', 'wardrobe'],
    collegeDistances: [
      { collegeId: 'col_iitd', distanceMeters: 900 },
      { collegeId: 'col_jnu', distanceMeters: 1600 },
    ],
    media: [
      { id: 'med_hf_1', type: 'photo', provider: 'unsplash', externalId: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=800&q=70', title: 'Bedroom', sortOrder: 1 },
      { id: 'med_hf_2', type: 'photo', provider: 'unsplash', externalId: 'https://images.unsplash.com/photo-1554995207-c18c203602cb?auto=format&fit=crop&w=800&q=70', title: 'Bedroom 2', sortOrder: 2 },
    ],
    food: { available: false },
    curfew: undefined,
    rules: ['Group booking preferred', 'No pets', 'Security deposit refundable on notice'],
    isMock: true,
  },
  {
    id: 'prop_campus_corner',
    ownerId: 'own_mock_06',
    name: 'Campus Corner Boys PG',
    slug: 'campus-corner-boys-pg-hauz-khas',
    propertyType: 'pg',
    gender: 'boys',
    address: 'DDA Market, Block B, Hauz Khas, Delhi',
    localityId: 'loc_hauz_khas',
    latitude: 28.5438,
    longitude: 77.1998,
    description:
      'Walk-to-campus PG with double and triple sharing near IIT Delhi main gate. Hot water 24x7 and strong WiFi.',
    verificationStatus: 'pg_hunter_verified',
    status: 'active',
    rating: null,
    reviewCount: 0,
    rooms: [
      { id: 'rm_cc_1', roomType: 'double', occupancy: 'Double sharing', rent: 13500, deposit: 13500, available: true },
      { id: 'rm_cc_2', roomType: 'triple', occupancy: 'Triple sharing', rent: 10000, deposit: 10000, available: true },
    ],
    amenitySlugs: ['wifi', 'food', 'geyser', 'housekeeping', 'cctv', 'study-table', 'attached-bath'],
    collegeDistances: [
      { collegeId: 'col_iitd', distanceMeters: 1600 },
      { collegeId: 'col_jnu', distanceMeters: 800 },
    ],
    media: [
      { id: 'med_cc_1', type: 'photo', provider: 'unsplash', externalId: 'https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?auto=format&fit=crop&w=800&q=70', title: 'Bedroom', sortOrder: 1 },
      { id: 'med_cc_2', type: 'video', provider: 'youtube', externalId: 'aqz-KE-bpKQ', title: 'Mock walkthrough (placeholder clip)', sortOrder: 2 },
    ],
    food: { available: true, type: 'both', monthlyCost: 3000 },
    curfew: '11 PM',
    rules: ['Bachelors only', 'Locker for each resident'],
    isMock: true,
  },
  {
    id: 'prop_jamia_hostel',
    ownerId: 'own_mock_07',
    name: 'Jamia Nagar Girls Hostel PG',
    slug: 'jamia-nagar-girls-hostel-pg',
    propertyType: 'pg',
    gender: 'girls',
    address: 'M-78, Jamia Nagar, Okhla, Delhi',
    localityId: 'loc_jamia',
    latitude: 28.5594,
    longitude: 77.2866,
    description:
      'Quiet, secure girls PG close to Jamia and IIIT Delhi. Library corner, healthy mess, and easy metro access.',
    verificationStatus: 'listed',
    status: 'active',
    rating: null,
    reviewCount: 0,
    rooms: [
      { id: 'rm_jh_1', roomType: 'double', occupancy: 'Double sharing', rent: 12500, deposit: 12500, available: true },
      { id: 'rm_jh_2', roomType: 'triple', occupancy: 'Triple sharing', rent: 9500, deposit: 9500, available: false },
    ],
    amenitySlugs: ['wifi', 'food', 'cctv', 'security', 'geyser', 'study-table', 'water-filter', 'housekeeping'],
    collegeDistances: [
      { collegeId: 'col_iiitd', distanceMeters: 1100 },
      { collegeId: 'col_jamia', distanceMeters: 0 },
    ],
    media: [
      { id: 'med_jh_1', type: 'photo', provider: 'unsplash', externalId: 'https://images.unsplash.com/photo-1560185007-cde436f6a4d0?auto=format&fit=crop&w=800&q=70', title: 'Room', sortOrder: 1 },
      { id: 'med_jh_2', type: 'video', provider: 'youtube', externalId: 'jNQXAC9IVRw', title: 'Mock walkthrough (placeholder clip)', sortOrder: 2 },
    ],
    food: { available: true, type: 'veg', monthlyCost: 2600 },
    curfew: '10 PM',
    rules: ['Girls only', 'Curfew 10 PM', 'Visitors need owner approval'],
    isMock: true,
  },
  {
    id: 'prop_mayur_fresh',
    ownerId: 'own_mock_08',
    name: 'Fresh Living Mayur Vihar',
    slug: 'fresh-living-mayur-vihar',
    propertyType: 'pg',
    gender: 'co-ed',
    address: 'C-5, Pocket A, Mayur Vihar Phase 3, Delhi',
    localityId: 'loc_mayur_vihar',
    latitude: 28.5948,
    longitude: 77.3243,
    description:
      'Newly renovated PG with an in-house gym and rooftop hangout. A short metro hop from IIIT Delhi.',
    verificationStatus: 'rishabh_irl_verified',
    status: 'active',
    rating: null,
    reviewCount: 0,
    rooms: [
      { id: 'rm_mf_1', roomType: 'single', occupancy: 'Single sharing', rent: 17500, deposit: 17500, available: true },
      { id: 'rm_mf_2', roomType: 'double', occupancy: 'Double sharing', rent: 12500, deposit: 12500, available: true },
    ],
    amenitySlugs: ['wifi', 'food', 'gym', 'ac', 'cctv', 'balcony', 'laundry', 'power-backup', 'refrigerator'],
    collegeDistances: [{ collegeId: 'col_iiitd', distanceMeters: 3400 }],
    media: [
      { id: 'med_mf_1', type: 'photo', provider: 'unsplash', externalId: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=70', title: 'Common area', sortOrder: 1 },
      { id: 'med_mf_2', type: 'video', provider: 'youtube', externalId: 'aqz-KE-bpKQ', title: 'Mock tour (placeholder clip)', sortOrder: 2 },
    ],
    food: { available: true, type: 'both', monthlyCost: 3300 },
    curfew: '12 AM',
    rules: ['Rooftop closed after 11 PM', 'Smoke-free building'],
    isMock: true,
  },
  {
    id: 'prop_north_campus',
    ownerId: 'own_mock_09',
    name: 'North Campus Boys PG',
    slug: 'north-campus-boys-pg',
    propertyType: 'pg',
    gender: 'boys',
    address: '29, Hudson Lane, Kingsway Camp, Delhi',
    localityId: 'loc_du_north',
    latitude: 28.6892,
    longitude: 77.2042,
    description:
      'The classic Hudson Lane boys PG — walking distance to DU North Campus colleges with mess included.',
    verificationStatus: 'pg_hunter_verified',
    status: 'active',
    rating: null,
    reviewCount: 0,
    rooms: [
      { id: 'rm_nc_1', roomType: 'double', occupancy: 'Double sharing', rent: 14500, deposit: 14500, available: true },
      { id: 'rm_nc_2', roomType: 'triple', occupancy: 'Triple sharing', rent: 10800, deposit: 10800, available: true },
      { id: 'rm_nc_3', roomType: 'four-plus', occupancy: 'Quad sharing', rent: 9000, deposit: 9000, available: true },
    ],
    amenitySlugs: ['wifi', 'food', 'laundry', 'geyser', 'study-table', 'cctv', 'housekeeping', 'wardrobe'],
    collegeDistances: [{ collegeId: 'col_du', distanceMeters: 800 }],
    media: [
      { id: 'med_nc_1', type: 'photo', provider: 'unsplash', externalId: 'https://images.unsplash.com/photo-1598928506311-c55ded91a20c?auto=format&fit=crop&w=800&q=70', title: 'Bedroom', sortOrder: 1 },
      { id: 'med_nc_2', type: 'video', provider: 'youtube', externalId: 'aqz-KE-bpKQ', title: 'Mock walkthrough (placeholder clip)', sortOrder: 2 },
    ],
    food: { available: true, type: 'both', monthlyCost: 3200 },
    curfew: '11 PM',
    rules: ['Boys only', 'No room guests after 10 PM'],
    isMock: true,
  },
  {
    id: 'prop_lajpat_exec',
    ownerId: 'own_mock_10',
    name: 'Lajpat Nagar Executive PG',
    slug: 'lajpat-nagar-executive-pg',
    propertyType: 'pg',
    gender: 'boys',
    address: 'D-29, Lajpat Nagar II, Delhi',
    localityId: 'loc_lajpat',
    latitude: 28.5664,
    longitude: 77.2447,
    description:
      'Premium single rooms with attached bathrooms in South Delhi. Ideal for working professionals and postgraduate students.',
    verificationStatus: 'listed',
    status: 'active',
    rating: null,
    reviewCount: 0,
    rooms: [
      { id: 'rm_le_1', roomType: 'single', occupancy: 'Single sharing', rent: 24000, deposit: 24000, available: true },
      { id: 'rm_le_2', roomType: 'double', occupancy: 'Double sharing', rent: 16500, deposit: 16500, available: false },
    ],
    amenitySlugs: ['wifi', 'ac', 'attached-bath', 'housekeeping', 'cctv', 'laundry', 'gym', 'parking', 'water-filter'],
    collegeDistances: [{ collegeId: 'col_jnu', distanceMeters: 4500 }],
    media: [
      { id: 'med_le_1', type: 'photo', provider: 'unsplash', externalId: 'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?auto=format&fit=crop&w=800&q=70', title: 'Premium room', sortOrder: 1 },
      { id: 'med_le_2', type: 'video', provider: 'youtube', externalId: 'jNQXAC9IVRw', title: 'Mock walkthrough (placeholder clip)', sortOrder: 2 },
    ],
    food: { available: true, type: 'both', monthlyCost: 4000 },
    curfew: '12 AM',
    rules: ['Professionals preferred', 'Advanced notice for visitors'],
    isMock: true,
  },
];

/** Starting (cheapest available) monthly rent for a property. */
export const startingRent = (p: Property): number =>
  p.rooms
    .filter((r) => r.available)
    .reduce((min, r) => Math.min(min, r.rent), Number.POSITIVE_INFINITY);

export const propertyBySlug = (slug: string): Property | undefined =>
  properties.find((p) => p.slug === slug);

export const activeProperties = (): Property[] => properties.filter((p) => p.status === 'active');

/** Primary display image for a property card. */
export const coverImage = (p: Property): PropertyMedia =>
  p.media.find((m) => m.type === 'photo') ?? p.media[0];
