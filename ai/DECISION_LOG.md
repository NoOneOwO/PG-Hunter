# PG Hunter â€” Decision Log

## Decision Template

### Decision
[What was decided]

### Date
[YYYY-MM-DD]

### Reason
[Why]

### Alternatives
[What else was considered]

### Impact
[Technical/product/business impact]

### Status
Approved / Superseded / Rejected

---

## Decision #001
### Decision
PG Hunter is the current product scope. Hunterz is not part of the active build.

### Reason
Prove the accommodation marketplace and management product before expanding.

### Status
Approved

---

## Decision #002
### Decision
The approved homepage screenshot is the visual source of truth.

### Reason
The founder has explicitly selected this design direction.

### Status
Approved

---

## Decision #003
### Decision
Use Astro 6 with a static-first/islands architecture.

### Reason
PG Hunter is content-heavy and discovery/search pages benefit from fast HTML delivery.

### Status
Approved

---

## Decision #004
### Decision
Use YouTube for initial property video hosting.

### Reason
Avoid the cost and complexity of custom video infrastructure during validation.

### Status
Approved

---

## Decision #005
### Decision
Start with Cloudflare Workers + D1 as the core backend/data architecture.

### Reason
It aligns the application with the Cloudflare deployment and edge database strategy.

### Status
Approved

---

## Decision #006
### Decision
Do not build PG Management before the discovery/lead foundation is stable.

### Reason
Discovery is the initial acquisition engine. Management becomes the retention layer.

### Status
Approved

---

## Decision #007
### Decision
Authentication and user data moved from Supabase to Cloudflare Workers + D1 (custom auth: PBKDF2 password hashing, opaque session cookies, manual Google OAuth 2.0).

### Date
2026-08-14

### Reason
Supabase was introduced as a temporary backend before the Cloudflare phase. The locked architecture (Decision #005) is Astro → Cloudflare Workers → D1. Keeping auth on Workers removes a second vendor and lets sessions, saved PGs and leads live in one D1 database. This supersedes the "evaluate Supabase Auth" note in MASTER_ARCHITECTURE.md.

### Alternatives
- Keep Supabase Auth and call it from the Worker. Rejected: splits auth data from the rest of the user data.
- Delegate to a third-party auth service (Auth.js, Clerk). Rejected: adds a dependency for features (email/password + Google + session cookies) that Workers handles directly.

### Impact
- All /api/* endpoints run in the same Worker as the site; sessions are httpOnly cookies (`ph_session`), so no tokens reach JavaScript.
- Passwords are hashed with PBKDF2-SHA256 (210k iterations, per-user salt) via WebCrypto in workerd — no raw passwords stored (DATABASE_SCHEMA.md rule).
- Google sign-in requires GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (wrangler secrets / .dev.vars) and the callback URL `{origin}/api/auth/google/callback` registered in Google Cloud Console.
- Email confirmation/verification is deferred; roles are self-declared (student/owner) for the MVP.

### Status
Approved


# Cloudflare Architecture Decisions â€” Final Decision Record

## Astro 6
Status: LOCKED

PG Hunter remains Astro 6 + Islands Architecture. The project will not switch to Next.js.

## Cloudflare Workers
Status: LOCKED

Workers provide the server/API layer around the Astro application and Cloudflare services.

## Cloudflare D1
Status: LOCKED

D1 is the primary SQL datastore for the MVP.

## Cloudflare R2
Status: LOCKED

R2 is the planned storage layer for property photos and controlled/private files when needed.

## YouTube for MVP videos
Status: LOCKED

Property walkthrough videos are initially hosted on YouTube to keep video infrastructure simple and low-cost. Cloudflare Stream is postponed.

## SQL search first
Status: LOCKED

D1 SQL filtering is sufficient for initial PG discovery. Vectorize and semantic search are postponed.

## AI later
Status: LOCKED

The AI Matchmaker is a later interactive feature. An LLM can eventually translate natural-language requirements into structured filters executed against D1. Custom model training is not a prerequisite.

## Verification is a state
Status: LOCKED

Use:
- unverified
- pg_hunter_verified
- rishabh_irl_verified

"Verified by Rishabh IRL" is a core trust/brand concept.

## Room-level pricing
Status: LOCKED

A property can contain different room/occupancy types with different rents.

## Turnstile tokens are not stored
Status: LOCKED

Turnstile is a server-side anti-bot verification mechanism, not application data.

## Privacy-first contact flow
Status: LOCKED

Student and owner contact information should not be unnecessarily exposed. Leads should initially flow through PG Hunter.

## Architecture Principle

Use Cloudflare-native infrastructure where it provides clear value, while deliberately postponing advanced services until real product requirements justify them.


# Cloudflare Architecture Decisions — Final Decision Record

## Astro 6

Status: LOCKED

PG Hunter remains Astro 6 + Islands Architecture. The project will not switch to Next.js.

## Cloudflare Workers

Status: LOCKED

Workers provide the server/API layer around the Astro application and Cloudflare services.

## Cloudflare D1

Status: LOCKED

D1 is the primary SQL datastore for the MVP.

## Cloudflare R2

Status: LOCKED

R2 is the planned storage layer for property photos and controlled/private files when needed.

## YouTube for MVP Videos

Status: LOCKED

Property walkthrough videos are initially hosted on YouTube to keep video infrastructure simple and low-cost.

Cloudflare Stream is postponed.

## SQL Search First

Status: LOCKED

D1 SQL filtering is sufficient for initial PG discovery.

Vectorize and semantic search are postponed.

## AI Later

Status: LOCKED

The AI Matchmaker is a later interactive feature.

An LLM can eventually translate natural-language requirements into structured filters executed against D1.

Custom model training is not a prerequisite.

## Verification Is a State

Status: LOCKED

Use:

- `unverified`
- `pg_hunter_verified`
- `rishabh_irl_verified`

"Verified by Rishabh IRL" is a core trust/brand concept.

## Room-Level Pricing

Status: LOCKED

A property can contain different room/occupancy types with different rents.

## Turnstile Tokens Are Not Stored

Status: LOCKED

Turnstile is a server-side anti-bot verification mechanism, not application data.

## Privacy-First Contact Flow

Status: LOCKED

Student and owner contact information should not be unnecessarily exposed.

Leads should initially flow through PG Hunter.

## Architecture Principle

Use Cloudflare-native infrastructure where it provides clear value, while deliberately postponing advanced services until real product requirements justify them.
---

## Decision #008 — Publication and Verification Are Separate Facts

### Decision
Publishing a listing (`owner_listings.status = 'active'`) never grants a
verification badge. Verification may only be granted through an explicit admin
action that records who verified, by what method, on what evidence, and until
when — written to the `listing_verifications` ledger (migration 0006).
Revocation is a status change on that ledger row, never a DELETE.

### Date
2026-10-02

### Reason
The pre-hardening admin approval path set `verification_status =
'pg_hunter_verified'` as a side effect of approving a listing, and admin
document approval did the same. That made the badge mean "somebody clicked
approve" rather than "a verification process happened", which violates
`ai/TRUTH_POLICY.md` and `ai/SECURITY_RULEBOOK.md` ("a verification badge is a
trust claim"). It also left no audit trail: pre-hardening badges have no ledger
row at all, so re-verification and revocation were impossible to reason about.

### Alternatives
- Keep auto-verification but rename the badge to something like "Listed".
  Rejected: the badge is a paid product (₹1,499 + travel) and the brand claim
  ("PG Hunter Verified", "Rishabh IRL Verified") must mean what it says.
- Store verification only as columns on `owner_listings`. Rejected: no history,
  so revocation and re-verification cannot be audited.
- Trust the stored column in API responses. Rejected: a badge that outlives its
  evidence is exactly the failure this decision exists to prevent.

### Impact
- `PUT /api/admin/listings/:id` now takes `action: 'grant' | 'revoke'` for
  verification, and `{ status }` purely for moderation. There is deliberately
  no field that writes `verification_status` directly.
- `verification_status` on `owner_listings` is a read cache of the newest
  approved ledger row; only `src/lib/server/verification.ts` may write it.
- A lapsed verification is reported as `unverified` in API responses, so a
  stale badge cannot render.
- Pre-hardening badges with no ledger row and an expiry in the past are
  reported as unverified. Re-verifying them requires a real verification.
- Revocation also returns the listing to `pending`, since a listing whose trust
  claim was withdrawn should not stay publicly published.

### Status
Approved

---

## Decision #009 — Listing Expiry Is Enforced on Read

### Decision
Basic listings are public for 15 days; Verified listings for 365. Visibility
requires `status = 'active'` AND a live plan window. Expired listings are kept
in D1 and hidden from public results so the owner can renew.

### Date
2026-10-02

### Reason
Migration 0006 added `plan` / `expires_at` but nothing read them, so an approved
listing was public forever and the paid tier had no operational difference from
the free one.

### Impact
- `GET /api/listings` filters on the window and gained `limit`/`offset` plus a
  `total`, so responses are bounded and pageable.
- Budget and room-type filters moved into SQL (`EXISTS` / correlated `MIN`)
  so they compose with pagination instead of filtering a page after the fact.
- Rows with no window recorded are treated as unexpired rather than hidden, so
  legacy listings cannot vanish silently.
- Renewal extends the window; an owner editing a listing does NOT, otherwise
  editing every two weeks would replace the reason to upgrade.

### Status
Approved

---

## Decision #010 — Verification-Sensitive Edits Re-Queue a Listing

### Decision
Editing a listing preserves its publication state. But if a field that the
verification attested to changes (address, locality, city, coordinates), the
listing goes back to `pending` and the badge is withdrawn until re-verified.
Changes to presentation only (name, description, rules, amenities, food,
curfew) keep the listing live and verified.

### Date
2026-10-02

### Reason
The owner `PUT` handler forced `status = 'draft'` on every edit, silently
unpublishing a live listing — and for an active `'draft'` listing the submit
guard then refused resubmission, so the owner could not recover. Conversely,
letting an address change ride on an existing physical-visit verification would
mean the badge attested to a property that had changed underneath it.

### Alternatives
- Re-queue on every edit. Rejected: punishes owners for fixing typos and makes
  the review queue useless.
- Never re-queue. Rejected: lets a verified listing be repointed at a different
  property while keeping the badge.

### Status
Approved

---

## Decision #011 — Basic Window Is 14 Days; the ₹1,499 Tier Is "Annual Listing"

### Decision
The free Basic listing window changes from 15 days to 14 days. The paid
₹1,499 / 365-day tier keeps its plan slug `verified` (which also gates the
physical visit + photography + video verification workflow) but is displayed to
owners and admins as "Annual Listing".

### Date
2026-10-09

### Reason
The founder confirmed the product policy: Basic is a 14-day window, and the
₹1,499 product is sold as an annual listing that includes the verification
visit. The prior display name ("PG Hunter Verified") described only the
verification half of the product and read as a different offering from the
annual listing owners actually buy. This supersedes the window in Decision #009.

### Alternatives
- Treat the ₹1,499 tier as a listing-duration-only plan and move verification
  out entirely. Rejected: the physical visit is still what the price pays for,
  so separating them would misrepresent what an owner receives.
- Rewrite the already-applied migration 0008. Rejected: an applied migration is
  history; rewriting it would leave existing databases on the old values while a
  fresh database got the new ones. Migration 0011 is the authoritative update.

### Impact
- `PLAN_WINDOW_DAYS.basic` is 14 (`src/lib/verificationRules.ts`); the
  `plans` table's `duration_days` is display copy and must match it.
- Migration 0011 updates the seeded catalogue for both existing and fresh
  databases.
- The verification *badge* labels ("PG Hunter Verified", "Rishabh IRL Verified")
  are unchanged — only the purchasable plan's display name changed.
- Prices (₹0 / ₹1,499), the 365-day window and the travel charge are unchanged.
  No payment provider exists, so no payment is implied anywhere.

### Status
Approved

## Decision #012 — Plan Payments Are Manual UPI, Confirmed by an Admin

### Decision
There is no payment gateway. An owner pays the platform's UPI id directly and
submits the UPI reference/UTR (migration 0013, table `plan_payments`). The row is
created as `submitted`; an admin confirms that the money actually arrived
(`confirmed`) or rejects it (`rejected`). Only a `confirmed` row counts as
revenue and only a confirmed row opens the paid plan window. The amount is copied
from the `plans` catalogue at submission, so repricing later cannot rewrite what
an owner was billed.

### Date
2026-10-09

### Reason
The founder chose a manual/UPI flow over integrating a gateway, so the product
can take real money now without card processing, KYC or a provider contract.
Everything must stay honest: nothing may imply a payment completed until an admin
confirms it, and no placeholder UPI account may ever be shown as payable.

### Alternatives
- Integrate a payment gateway (Razorpay etc.). Deferred: needs a provider
  account, API keys and reconciliation design; out of scope for this phase.
- Auto-confirm on the owner's reference. Rejected: a reference is a claim, not
  proof. Only a human checking the account statement may mark money received.

### Impact
- `plan_payments` (0013) is the payment ledger; `amount_inr` is frozen per row.
- `src/lib/payments.ts` holds the pure rules (UPI config, reference validation,
  status metadata, revenue summary); `src/lib/server/payments.ts` owns the D1
  reads/writes. Tests: `test/payments.test.mts`.
- Owner checkout (`/owner/plans/verified`) shows the UPI id and a reference form
  when `UPI_ID` is configured; otherwise it says payments are not configured yet.
- Admin `/admin/payments` is the confirmation queue with a confirmed-revenue
  total; confirming opens the plan window via `ensurePlanWindow`. Verification
  (the badge) is a separate ledger and is never granted by a payment.
- The UPI id is a plaintext var (`UPI_ID`, `UPI_PAYEE_NAME`) because it is shown
  publicly to payers; no secret is involved. It is unset by default.

### Status
Approved
