import type { College, Locality } from './types';

/**
 * MOCK DATA — development placeholder. Replaced by D1 in Phase 2.
 * Colleges and localities are representative of the Delhi ecosystem
 * the product plans to start in. Do not treat counts as live facts.
 */

export const colleges: College[] = [
  {
    id: 'col_dtu',
    name: 'Delhi Technological University',
    shortName: 'DTU',
    slug: 'dtu',
    city: 'Delhi',
    locality: 'Rohini',
    latitude: 28.7495,
    longitude: 77.1174,
  },
  {
    id: 'col_nsut',
    name: 'Netaji Subhas University of Technology',
    shortName: 'NSUT',
    slug: 'nsut',
    city: 'Delhi',
    locality: 'Dwarka',
    latitude: 28.6093,
    longitude: 77.0275,
  },
  {
    id: 'col_iitd',
    name: 'IIT Delhi',
    shortName: 'IIT Delhi',
    slug: 'iit-delhi',
    city: 'Delhi',
    locality: 'Hauz Khas',
    latitude: 28.5453,
    longitude: 77.1926,
  },
  {
    id: 'col_iiitd',
    name: 'IIIT Delhi',
    shortName: 'IIITD',
    slug: 'iiit-delhi',
    city: 'Delhi',
    locality: 'Okhla',
    latitude: 28.5458,
    longitude: 77.2733,
  },
  {
    id: 'col_ipu',
    name: 'Guru Gobind Singh Indraprastha University',
    shortName: 'IPU',
    slug: 'ipu',
    city: 'Delhi',
    locality: 'Dwarka',
    latitude: 28.5924,
    longitude: 77.0163,
  },
  {
    id: 'col_jnu',
    name: 'Jawaharlal Nehru University',
    shortName: 'JNU',
    slug: 'jnu',
    city: 'Delhi',
    locality: 'New Delhi',
    latitude: 28.5421,
    longitude: 77.1675,
  },
  {
    id: 'col_du',
    name: 'Delhi University North Campus',
    shortName: 'DU North',
    slug: 'du-north-campus',
    city: 'Delhi',
    locality: 'North Campus',
    latitude: 28.6884,
    longitude: 77.2094,
  },
  {
    id: 'col_jamia',
    name: 'Jamia Millia Islamia',
    shortName: 'Jamia',
    slug: 'jamia-millia-islamia',
    city: 'Delhi',
    locality: 'Okhla',
    latitude: 28.5612,
    longitude: 77.2844,
  },
];

export const localities: Locality[] = [
  { id: 'loc_rohini', name: 'Rohini', slug: 'rohini', city: 'Delhi' },
  { id: 'loc_dwarka', name: 'Dwarka', slug: 'dwarka', city: 'Delhi' },
  { id: 'loc_hauz_khas', name: 'Hauz Khas', slug: 'hauz-khas', city: 'Delhi' },
  { id: 'loc_okhla', name: 'Okhla', slug: 'okhla', city: 'Delhi' },
  { id: 'loc_jamia', name: 'Jamia Nagar', slug: 'jamia-nagar', city: 'Delhi' },
  { id: 'loc_south_ext', name: 'South Extension', slug: 'south-extension', city: 'Delhi' },
  { id: 'loc_lajpat', name: 'Lajpat Nagar', slug: 'lajpat-nagar', city: 'Delhi' },
  { id: 'loc_mayur_vihar', name: 'Mayur Vihar', slug: 'mayur-vihar', city: 'Delhi' },
];

export const localityById = (id: string): Locality | undefined =>
  localities.find((l) => l.id === id);

export const localityBySlug = (slug: string): Locality | undefined =>
  localities.find((l) => l.slug === slug);

export const collegeBySlug = (slug: string): College | undefined =>
  colleges.find((c) => c.slug === slug);

export const collegeById = (id: string): College | undefined =>
  colleges.find((c) => c.id === id);
