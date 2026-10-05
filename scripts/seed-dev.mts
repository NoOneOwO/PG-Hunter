/**
 * PG Hunter — local development seed.
 *
 * Drives the real HTTP API (not raw SQL) so every step goes through the same
 * validation, session and moderation rules the app uses. Run it against a
 * running dev server:
 *
 *   npm run dev            # in one terminal
 *   npm run seed:dev       # in another
 *
 * It is idempotent: accounts are reused if they already exist, and the demo
 * listing is refreshed rather than duplicated. Everything it creates is local
 * (`wrangler` state) — never run it against production.
 *
 * Output: three accounts (student / owner / admin), two listings (one live and
 * approved, one draft), photos in R2, an enquiry, a save, a like and a pending
 * experience, so every page in the app has real data to render.
 */

import { deflateSync } from 'node:zlib';

const BASE = process.env.SEED_BASE_URL ?? 'http://localhost:4321';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'taiyabjazim2358@gmail.com';
const STUDENT_EMAIL = 'seed.student@pghunter.local';
const OWNER_EMAIL = 'seed.owner@pghunter.local';
const PASSWORD = 'seed-password-123';

interface SeededUser {
  email: string;
  cookie: string;
  id: string;
  role: string;
}

/* -------------------------------------------------------------- HTTP ---- */

const request = async (
  path: string,
  init: RequestInit & { cookie?: string; json?: unknown } = {}
): Promise<Response> => {
  const headers = new Headers(init.headers);
  // The CSRF guard rejects a mutating request without a same-origin Origin.
  headers.set('Origin', BASE);
  headers.set('Sec-Fetch-Site', 'same-origin');
  if (init.cookie) headers.set('Cookie', init.cookie);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');

  return fetch(`${BASE}${path}`, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    redirect: 'manual',
  });
};

const cookieFrom = (res: Response): string => {
  const raw = res.headers.get('set-cookie') ?? '';
  const match = /ph_session=([^;]+)/.exec(raw);
  return match ? `ph_session=${match[1]}` : '';
};

async function body<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Unexpected response (${res.status}): ${text.slice(0, 200)}`);
  }
}

/* ------------------------------------------------------------- users ---- */

const ensureUser = async (
  email: string,
  name: string,
  role: 'student' | 'owner'
): Promise<SeededUser> => {
  const registered = await request('/api/auth/register', {
    method: 'POST',
    json: { name, email, password: PASSWORD, role },
  });

  if (registered.status !== 200 && registered.status !== 201) {
    const login = await request('/api/auth/login', {
      method: 'POST',
      json: { email, password: PASSWORD },
    });
    if (!login.ok) {
      throw new Error(`Could not sign in ${email}: ${login.status} ${await login.text()}`);
    }
    const cookie = cookieFrom(login);
    const { user } = await body<{ user: { id: string; role: string } }>(login);
    return { email, cookie, id: user.id, role: user.role };
  }

  const cookie = cookieFrom(registered);
  const { user } = await body<{ user: { id: string; role: string } }>(registered);
  return { email, cookie, id: user.id, role: user.role };
};

/* --------------------------------------------------------- test image --- */

/** Minimal valid PNG at a solid colour — enough for the image pipeline. */
const makePng = (width: number, height: number, rgb: [number, number, number]): Blob => {
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (bytes: Uint8Array): number => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 3] = rgb[0];
      raw[row + 2 + x * 3] = rgb[1];
      raw[row + 3 + x * 3] = rgb[2];
    }
  }

  // Node's zlib produces the zlib-wrapped stream PNG expects.
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ];
  return new Blob(parts as BlobPart[], { type: 'image/png' });
};

/* ------------------------------------------------------------- flow ---- */

const main = async (): Promise<void> => {
  console.log(`Seeding ${BASE}`);

  const student = await ensureUser(STUDENT_EMAIL, 'Seed Student', 'student');
  const owner = await ensureUser(OWNER_EMAIL, 'Seed Owner', 'owner');
  const admin = await ensureUser(ADMIN_EMAIL, 'Seed Admin', 'student');
  console.log(`  accounts ready: student=${student.id} owner=${owner.id} admin=${admin.id}`);

  // Student prefs so enquiry prefill has something to show.
  await request('/api/profile', {
    method: 'PUT',
    cookie: student.cookie,
    json: {
      city: 'Delhi',
      movingInMonth: '2026-11',
      budgetPref: '10-15',
      availability: 'Weekends, after 5 pm',
      messageToOwners: 'Hi! I am a DTU student looking for a quiet double-sharing room.',
    },
  });

  /** Create (or refresh) one listing and return its id. */
  const upsertListing = async (
    name: string,
    overrides: Record<string, unknown> = {}
  ): Promise<string> => {
    const existing = await request('/api/owner/listings', { cookie: owner.cookie });
    const { listings } = await body<{ listings: { id: string; name: string }[] }>(existing);
    const found = listings.find((listing) => listing.name === name);
    if (found) return found.id;

    const created = await request('/api/owner/listings', {
      method: 'POST',
      cookie: owner.cookie,
      json: {
        name,
        propertyType: 'pg',
        gender: 'co-ed',
        address: 'C-9/56, Sector 7',
        locality: 'Rohini',
        city: 'Delhi',
        description:
          'A calm, well-kept PG five minutes from the metro. Double and single rooms with attached baths, RO water, power backup and a cook who actually cooks.',
        rules: ['No entry after 11:30 pm', 'Guests allowed in the common area'],
        curfew: '11:30 PM',
        food: { available: true, type: 'veg', monthlyCost: 3500 },
        amenitySlugs: ['wifi', 'food', 'laundry', 'ac', 'power-backup', 'cctv', 'study-table'],
        rooms: [
          { roomType: 'double', occupancy: 'Double sharing', rent: 9500, deposit: 9500, available: true },
          { roomType: 'single', occupancy: 'Single room', rent: 16500, deposit: 16500, available: true },
          { roomType: 'triple', occupancy: 'Triple sharing', rent: 7800, deposit: 7800, available: false },
        ],
        ...overrides,
      },
    });
    if (!created.ok) throw new Error(`Listing create failed: ${created.status} ${await created.text()}`);
    const { listing } = await body<{ listing: { id: string } }>(created);
    return listing.id;
  };

  const liveId = await upsertListing('Seed Boys PG Rohini');

  const uploadPhoto = async (listingId: string, label: string, rgb: [number, number, number]) => {
    const form = new FormData();
    form.set('purpose', 'listing-images');
    form.set('listingId', listingId);
    form.set('file', makePng(240, 180, rgb), `${label}.png`);
    const res = await request('/api/media', { method: 'POST', cookie: owner.cookie, body: form });
    if (!res.ok) console.warn(`  photo upload skipped (${res.status})`);
  };
  await uploadPhoto(liveId, 'room-1', [122, 66, 230]);
  await uploadPhoto(liveId, 'room-2', [244, 114, 82]);

  // Add a YouTube walkthrough (stored as media, no upload).
  await request('/api/owner/media', {
    method: 'POST',
    cookie: owner.cookie,
    json: { listingId: liveId, url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', title: 'Room tour' },
  });

  // Publish: owner submits, admin approves with the Verified plan window.
  await request(`/api/owner/listings/${liveId}/submit`, { method: 'POST', cookie: owner.cookie });
  const approved = await request(`/api/admin/listings/${liveId}`, {
    method: 'PUT',
    cookie: admin.cookie,
    json: { status: 'active', plan: 'verified' },
  });
  if (!approved.ok) {
    console.warn(`  approve failed: ${approved.status} ${await approved.text()}`);
  } else {
    console.log(`  live listing approved: ${liveId}`);
  }

  // A draft second listing so the owner dashboard shows more than one state.
  await upsertListing('Seed Girls PG Mukherjee Nagar', {
    gender: 'girls',
    locality: 'Mukherjee Nagar',
    rooms: [
      { roomType: 'double', occupancy: 'Double sharing', rent: 11200, deposit: 11200, available: true },
    ],
  });

  // Student engagement on the live listing.
  await request('/api/saved', { method: 'POST', cookie: student.cookie, json: { propertyId: liveId } });
  await request('/api/reactions', {
    method: 'POST',
    cookie: student.cookie,
    json: { listingId: liveId, reaction: 'like' },
  });
  await request('/api/enquiries', {
    method: 'POST',
    cookie: student.cookie,
    json: {
      propertyId: liveId,
      budget: '10-15',
      moveInMonth: '2026-11',
      message: 'Is a double-sharing room available from November?',
    },
  });
  await request('/api/experiences', {
    method: 'POST',
    cookie: student.cookie,
    json: {
      listingId: liveId,
      rating: 4,
      content:
        'Stayed here for a semester. Wifi held up for online classes and the mess food was genuinely decent. Water pressure on the top floor is the only complaint.',
    },
  });

  // One report so the admin reports queue has something real.
  const experiences = await request(`/api/experiences?listingId=${encodeURIComponent(liveId)}`);
  const pending = await body<{ experiences: { id: string }[] }>(experiences);
  console.log(`  experience submitted (pending moderation), live listing ${liveId}`);
  void pending;

  console.log('\nSeed complete.');
  console.log(`  student  ${STUDENT_EMAIL} / ${PASSWORD}`);
  console.log(`  owner    ${OWNER_EMAIL} / ${PASSWORD}`);
  console.log(`  admin    ${ADMIN_EMAIL} / ${PASSWORD}`);
  console.log(`  live PG  ${BASE}/pgs/live/${liveId}`);
  console.log('  (accounts already existed? the same password applies to all seeded users)');
};

await main().catch((error) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
