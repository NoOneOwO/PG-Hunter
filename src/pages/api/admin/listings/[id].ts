import type { APIContext } from 'astro';
import { getDb, json, readBody, requireAdmin } from '@/lib/server/auth';
import { fetchListing, listingDto } from '@/lib/server/listings';
import { mediaUrl } from '@/lib/server/media';
import { ensurePlanWindow, clearPlanWindow, LISTING_PLANS, type ListingPlan } from '@/lib/server/listingPlans';
import {
  grantVerification,
  revokeVerification,
  VERIFICATION_METHODS,
  VERIFICATION_TIERS,
  type VerificationMethod,
  type VerificationTier,
} from '@/lib/server/verification';

export const prerender = false;

const VALID_STATUSES = ['pending', 'active', 'rejected'] as const;

/**
 * Moderate a listing, and separately manage its verification claim.
 *
 * Two hard rules, both of which the pre-hardening code broke:
 *
 *   1. Approving a listing (status -> 'active') does NOT verify it. Publishing
 *      and verifying are different facts, and only a human who actually
 *      performed a verification may assert the second one.
 *   2. A verification badge can only be granted through `action: 'grant'`,
 *      which demands a method and evidence and writes an auditable ledger row.
 *      There is deliberately no field that sets `verification_status`
 *      directly — that was the bug.
 */
export async function PUT(context: APIContext) {
  const admin = await requireAdmin(context);
  if ('error' in admin) return admin.error;

  const db = getDb();
  const id = context.params.id ?? '';
  const exists = await db
    .prepare('SELECT id, status FROM owner_listings WHERE id = ?')
    .bind(id)
    .first<{ id: string; status: string }>();
  if (!exists) return json({ error: 'Listing not found.' }, 404);

  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const reviewer = { id: admin.user.id };

  // ---------------------------------------------------------------- verification
  // Handled first and independently, so a verification decision is never a
  // side effect of a moderation decision.
  const action = body.action ? String(body.action) : '';
  if (action) {
    if (action === 'revoke') {
      const reason = String(body.reason ?? '').trim();
      if (!reason) {
        return json(
          { error: 'A revocation reason is required — the ledger records why a badge was withdrawn.' },
          400
        );
      }
      await revokeVerification(db, { listingId: id, reason, reviewer });
    } else if (action === 'grant') {
      const tier = String(body.tier ?? '');
      // Accept both names: `method` is what the client sends, and
      // `verificationMethod` is the name used elsewhere in this API's
      // vocabulary. Reading only one of them silently recorded every grant as
      // a document review, which would make the ledger untrustworthy.
      const method = String(body.method ?? body.verificationMethod ?? 'document_review');
      const evidence = String(body.evidence ?? '').trim();

      if (!VERIFICATION_TIERS.includes(tier as VerificationTier)) {
        return json({ error: `Tier must be one of: ${VERIFICATION_TIERS.join(', ')}.` }, 400);
      }
      if (!VERIFICATION_METHODS.includes(method as VerificationMethod)) {
        return json(
          {
            error: `Verification method must be one of: ${VERIFICATION_METHODS.join(', ')} (received ${JSON.stringify(method)}).`,
          },
          400
        );
      }
      if (!evidence) {
        return json(
          {
            error:
              'Evidence is required before granting verification. Describe what was actually checked (visit date, documents sighted, footage reviewed). The badge attests to a real verification process, so a bare click is refused.',
          },
          400
        );
      }

      try {
        await grantVerification(db, {
          listingId: id,
          tier: tier as VerificationTier,
          method: method as VerificationMethod,
          evidence,
          note: body.note ?? null,
          expiresAt: body.verificationExpiresAt ?? null,
          reviewer,
        });
      } catch (err) {
        return json({ error: (err as Error).message }, 400);
      }
    } else {
      return json({ error: "Action must be 'grant' or 'revoke'." }, 400);
    }

    const afterVerification = await fetchListing(db, id);
    if (!afterVerification) return json({ error: 'Listing not found.' }, 404);
    return json({ listing: listingDto(afterVerification.row, afterVerification.rooms, afterVerification.media, mediaUrl) });
  }

  // ---------------------------------------------------------------- moderation
  const status = String(body.status ?? '');
  if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    return json({ error: `Status must be one of: ${VALID_STATUSES.join(', ')}.` }, 400);
  }
  const rejectionReason =
    status === 'rejected' ? String(body.rejectionReason ?? '').trim() || 'Rejected by admin' : null;

  // Preserve the caller's words exactly; this is written back to the owner.
  await db
    .prepare('UPDATE owner_listings SET status = ?, rejection_reason = ? WHERE id = ?')
    .bind(status, rejectionReason, id)
    .run();

  if (status === 'active') {
    // Open the publication window. The plan is whatever the listing is on —
    // approving never silently upgrades anyone to the paid Verified tier.
    const plan: ListingPlan = body.plan && LISTING_PLANS.includes(String(body.plan) as ListingPlan)
      ? (String(body.plan) as ListingPlan)
      : 'basic';
    await ensurePlanWindow(db, { listingId: id, plan, renew: true });
  } else if (status === 'rejected') {
    await clearPlanWindow(db, id);
  }

  const full = await fetchListing(db, id);
  if (!full) return json({ error: 'Listing not found.' }, 404);
  return json({ listing: listingDto(full.row, full.rooms, full.media, mediaUrl) });
}
