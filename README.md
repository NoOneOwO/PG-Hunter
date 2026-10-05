# PG Hunter

**Find a place you'll actually want to live.**

PG Hunter is a student-first accommodation marketplace for Delhi-NCR. It helps
students discover PGs, hostels, co-living spaces and student-friendly flats near
their college using real information — price, location, amenities, availability
and walkthrough video — instead of rumour and phone calls.

Students use it for free. Property owners use it to publish listings, receive
qualified enquiries and (optionally) get verified.

---

## 1. What this project is

### Who it's for

- **Students** (and their parents) searching for a place to live near campus.
- **PG / hostel / co-living owners** who want real enquiries instead of noise.
- **PG Hunter admins** who moderate listings and run verification.

### The core promise

Reduce uncertainty *before* a student visits a property. A listing should tell
you what the place is, what it costs, what's included and who vouched for it —
honestly.

### What makes it different

- **Video-first discovery** — room-tour video on listings, not just photos.
- **Two verification tiers** — `PG Hunter Verified` and `Rishabh IRL Verified`,
  backed by an auditable evidence ledger rather than a self-declared badge.
- **Transparent pricing** — rent lives at the room level; cards show a real
  "starting from" price. Plan prices are stored as data, not hard-coded in markup.
- **Lead generation for owners** — enquiries land in an owner inbox.
- **Truth over decoration** — see §7 and [`ai/TRUTH_POLICY.md`](ai/TRUTH_POLICY.md).

### Current maturity — read this before you demo it

PG Hunter is **pre-launch** and the repository is in a documented hybrid state:

| Area | Status |
|---|---|
| Auth (email/password + Google), sessions, profiles, saved PGs, enquiries | **Live**, backed by Cloudflare D1 |
| Owner dashboard (listings, rooms, media, leads, plans, verification docs) | **Live**, D1 + R2 |
| Admin panel (moderation, verification ledger, tours, reports, stats) | **Live** |
| Public listing API `GET /api/listings` (search/filter/sort/pagination) | **Live**, D1 |
| Public marketing/catalogue pages (`/`, `/pgs/[slug]`, `/colleges`, `/localities`, `/pgs-near-you`) | **Static**, rendered from the bundled **sample dataset** in `src/data/` |

In other words: the **transactional product** (accounts, owners, admins, media,
moderation) runs against a real database, while the **public catalogue pages**
are still prerendered from placeholder data that is clearly marked `MOCK DATA`
in [`src/data/properties.ts`](src/data/properties.ts) and
[`src/data/colleges.ts`](src/data/colleges.ts). Do not treat the bundled listings
as live inventory.

---

## 2. How it works

### Stack

| Layer | Choice |
|---|---|
| Frontend | Astro 6 (islands, static-first) |
| Language | TypeScript |
| Styling | Tailwind CSS 4 |
| Icons | Lucide (`@lucide/astro`) |
| Runtime / API | Cloudflare Workers (via `@astrojs/cloudflare`) |
| Database | Cloudflare D1 (SQLite) |
| Object storage | Cloudflare R2 (owner photos + private verification docs) |
| Video | YouTube (ids only — Cloudflare Stream is deliberately deferred) |
| Auth | Custom: PBKDF2-SHA256 passwords + opaque `httpOnly` session cookies, plus Google OAuth 2.0 |

The locked architecture lives in [`ai/MASTER_ARCHITECTURE.md`](ai/MASTER_ARCHITECTURE.md).
There is **one Worker** and **one origin**: the Astro site and every `/api/*`
route ship together, so there are no cross-origin calls and no tokens in the
browser — authentication is a plain `httpOnly` cookie.

### Request flow

```
Browser
  │  static HTML for prerendered pages (served from the Worker's asset store)
  │  ── or ──
  │  on-demand request to /api/*, /admin/*, /owner/*, /profile …
  ▼
Astro middleware  ──►  1. CSRF / cross-origin rejection (mutating methods)
  (src/middleware.ts)   2. rate limiting (D1-backed fixed window)
                        3. security response headers
  ▼
Route handler  ──►  auth/session check  ──►  D1  /  R2  /  Google
  ▼
Response (JSON or redirect)
```

- **Static-first.** Pages without `prerender = false` are built to HTML and
  served as static assets — they never touch the Worker.
- **On-demand routes** (`/api/*` and the authenticated dashboards — 49 pages)
  run through [`src/middleware.ts`](src/middleware.ts) on every request.
- **Business logic stays out of components.** Server-side concerns live under
  [`src/lib/server/`](src/lib/server); presentation is in `src/components` and
  `src/pages`.

### Accounts & roles

Three roles, resolved from the `users` table:

- **student** — discover listings, save PGs, send enquiries.
- **owner** — everything a student can do, plus a dashboard to create/submit
  listings, upload media, read leads and manage a listing plan.
- **admin** — accounts whose email is listed in `ADMIN_EMAILS`; they are
  auto-promoted on login/register and are the only ones who can reach
  `/api/admin/*`. Everyone else gets `403`.

### Authentication

**Email + password.** Passwords are never stored in the clear. A per-user random
salt plus PBKDF2-SHA256 (210,000 iterations) is derived with WebCrypto inside
workerd ([`src/lib/server/auth.ts`](src/lib/server/auth.ts)). Login compares
digests with a constant-time comparison.

**Google sign-in.** A hand-rolled OAuth 2.0 authorization-code flow — no hosted
auth provider. It issues a single-use, `SameSite=Lax` `state` cookie, validates
it on the callback, exchanges the code for tokens, reads the profile, upserts
the user, then creates a session. See
[`src/lib/server/oauth.ts`](src/lib/server/oauth.ts) and
[`src/pages/api/auth/google/`](src/pages/api/auth/google). If Google credentials
are absent, the endpoint refuses cleanly (`/login?error=google-not-configured`)
and email/password still works.

**Sessions.** An opaque random token stored in the `sessions` table with a
30-day expiry, carried in the `ph_session` cookie (`httpOnly`, `Secure` over
HTTPS, `SameSite=Lax`). No JWTs, nothing readable by client code.

### Publication vs. verification — the rule that matters most

These are **two independent facts** and the codebase enforces that they stay
independent:

| Fact | Column | Values |
|---|---|---|
| Moderation / publication | `owner_listings.status` | `draft`, `pending`, `active`, `rejected` |
| Verification | `owner_listings.verification_status` | `unverified`, `pg_hunter_verified`, `rishabh_irl_verified` |

- Publishing a listing (`status = 'active'`) **never** grants a verification
  badge. Verification is a separate admin action that requires real evidence and
  writes an auditable row to the `listing_verifications` ledger.
- The stored `verification_status` is a **read cache** of the newest approved
  ledger row; only [`src/lib/server/verification.ts`](src/lib/server/verification.ts)
  may write it.
- Revoking verification keeps the ledger row (marked `revoked`) — history is
  never deleted — and returns the listing to `pending`.
- A listing that expires, or whose verification lapses, is reported as
  `unverified` on the way out, so a stale badge cannot render.

### Listing plans & expiry

Owners pick a plan when they publish. Plan data is stored in the `plans` table
(migration `0008`), not hard-coded in page markup, so prices and durations can
change without a redeploy:

- **Basic Listing** — ₹0, live for 15 days.
- **PG Hunter Verified** — ₹1,499, verified badge for 1 year (physical visit +
  photography + walkthrough video).

A public listing is visible only when it is **both** `active` **and** inside its
plan window (`expires_at` in the future, or `NULL` for legacy rows). Expiry is
enforced when public listings are read: expired listings are hidden but never
deleted, so an owner can renew. Verification-sensitive edits (address, locality,
city, coordinates) re-queue the listing to `pending` and invalidate the badge.
The policy lives in [`src/lib/verificationRules.ts`](src/lib/verificationRules.ts).

### Media

- **Photos and private documents** go to **R2** via `POST /api/media`.
  Listing images are served publicly at `/api/media/...`; verification documents
  are readable only by their owner and admins.
- **Walkthrough video** is a **YouTube id** (no raw video storage) — see
  [`src/lib/server/media.ts`](src/lib/server/media.ts) and
  [`src/components/VideoPlayer.astro`](src/components/VideoPlayer.astro). Admins
  attach tours to listings.

### Security

- **CSRF / cross-origin gate** — mutating requests must carry positive
  same-origin evidence (`Origin` or `Referer`); `Sec-Fetch-Site` can only reject,
  never grant ([`src/lib/server/requestPolicy.ts`](src/lib/server/requestPolicy.ts)).
- **Rate limiting** — D1-backed fixed windows per scope (login, register, OAuth,
  uploads, writes…). Caller identifiers are hashed before storage, optionally
  HMAC'd with `RATE_LIMIT_SALT`. The limiter fails open so it can never take the
  site down ([`src/lib/server/rateLimit.ts`](src/lib/server/rateLimit.ts)).
- **Security headers** — a strict CSP and friends, applied by middleware and
  baked into `dist/_headers` for static assets
  ([`src/lib/server/securityHeaders.ts`](src/lib/server/securityHeaders.ts)).
- **Output escaping** — untrusted values are escaped before entering any
  `innerHTML` sink ([`src/lib/html.ts`](src/lib/html.ts)).

---

## 3. Repository layout

```
src/
  pages/            routes — .astro pages + api/ handlers
    api/auth/       register, login, logout, me, google OAuth
    api/owner/      listings, media, leads, verification
    api/admin/      moderation, verification ledger, tours, reports, stats
  components/       presentational building blocks (PropertyCard, ListingForm…)
    bits/           React Bits-style motion components (Aurora, BlurText,
                    CountUp, SpotlightCard, StarBorder, AnimatedContent)
  layouts/          Base / Owner / Admin shells
  lib/              shared client + pure logic (auth client, format, plans, html)
    pixel/          the pixel engine + scene painters (skyline, hero-city,
                    campus, map, room)
    motion/         shared Motion layer: entrances, hover, press wiring
    server/         Worker-only logic: auth, oauth, listings, media,
                    verification, rateLimit, requestPolicy, securityHeaders
  data/             bundled SAMPLE catalogue (properties, colleges, amenities)
db/migrations/      0001…0009 — see §5
test/               node:test unit suites
public/             static assets (favicon, robots.txt, og image)
ai/                 the project's behavioural docs (see §6)
wrangler.toml       Worker config: D1 + R2 bindings, vars
astro.config.mjs    Astro config (Cloudflare adapter, Tailwind, sitemap)
```

---

## 4. Running it locally

You need Node 20+ (developed on Node 24). No Cloudflare account is required —
D1 and R2 run locally inside the dev runtime.

```bash
npm install

# Create the local (SQLite) database and apply every migration
npx wrangler d1 migrations apply pg_hunter --local

# Start the site with the real Worker runtime + local D1 + local R2
npm run dev            # http://localhost:4321

# Optional: create demo accounts, a listing with photos, enquiries, experiences
npm run seed:dev       # idempotent; re-running is safe
```

`npm run seed:dev` talks to the running dev server through the real API (so it
exercises the same guards as a browser) and creates
`seed.student@pghunter.local`, `seed.owner@pghunter.local` and the admin from
`ADMIN_EMAILS`, all with password `seed-password-123`.

### Google sign-in locally

Copy the example env file and fill in your own OAuth client:

```bash
cp .dev.vars.example .dev.vars
```

```env
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxx
ADMIN_EMAILS=you@example.com
```

Register the redirect URI `http://localhost:4321/api/auth/google/callback` in
[Google Cloud Console](https://console.cloud.google.com/apis/credentials) →
**Web application** client. Without these values the Google button shows a
"not configured" message and email/password still works.

**Becoming an admin locally:** put your email in `ADMIN_EMAILS`, then register
or log in with it — you're promoted automatically.

**Resetting local data:** stop the server, `rm -rf .wrangler/state`, then
re-apply migrations.

Full Cloudflare setup (production D1, R2 bucket, secrets, custom domain) is in
[`CLOUDFLARE_SETUP.md`](CLOUDFLARE_SETUP.md).

---

## 5. Database

Everything is plain SQL migrations under [`db/migrations/`](db/migrations),
applied with `wrangler d1 migrations apply pg_hunter --local|--remote`:

| Migration | Adds |
|---|---|
| `0001_init` | `users`, `sessions`, `saved_pgs`, `leads` |
| `0002_owner_admin` | `is_admin`, `owner_listings`, `listing_rooms`, `media`, `verification_documents` |
| `0003_owner_analytics` | legacy `listing_events` |
| `0004_pg_engagement` | `pg_engagement_events`, `pg_reactions`, `pg_experiences` |
| `0005_admin_moderation` | `moderation_actions`, `reports` |
| `0006_verification_and_expiry` | `listing_verifications` ledger, `plan`/`expires_at`, verification cache |
| `0007_rate_limits` | rate-limit counters |
| `0008_plans_pricing` | `plans` table + seeded plan catalogue |
| `0009_student_preferences` | `users.city`, `moving_in_month`, `budget_pref`, `availability`, `message_to_owners` (student hunt preferences that pre-fill enquiries) |

Schema details: [`ai/DATABASE_SCHEMA.md`](ai/DATABASE_SCHEMA.md).

---

## 6. Testing & quality

```bash
npm test         # node:test unit suites
npm run check    # astro check — TypeScript + template diagnostics
npm run build    # production build (must pass before deploy)
npm run seed:dev # API-driven dev seed: users, listings, photos, enquiries
npm run deploy   # astro build && wrangler deploy
```

`npm test` runs five suites in [`test/`](test): public listing/expiry
rules, the plan catalogue (asserting the SQL seed and the code fallback cannot
drift), HTML escaping, request policy (CSRF + rate-limit routing), and the
security headers (CSP directives, script hashes, media hosts). New pure
logic under `src/lib` should get a test here.

---

## 7. Documentation

The project's own rules live in [`ai/`](ai) — read them before changing
behaviour. The most important:

- [`ai/TRUTH_POLICY.md`](ai/TRUTH_POLICY.md) — never invent facts, credentials or prices.
- [`ai/MASTER_ARCHITECTURE.md`](ai/MASTER_ARCHITECTURE.md) — the locked stack.
- [`ai/SECURITY_RULEBOOK.md`](ai/SECURITY_RULEBOOK.md) — auth, CSRF, escaping.
- [`ai/DATABASE_SCHEMA.md`](ai/DATABASE_SCHEMA.md) — tables and columns.
- [`ai/DECISION_LOG.md`](ai/DECISION_LOG.md) — why publication, verification and expiry work the way they do.
- [`CLOUDFLARE_SETUP.md`](CLOUDFLARE_SETUP.md) — local + production setup and the full API reference.
