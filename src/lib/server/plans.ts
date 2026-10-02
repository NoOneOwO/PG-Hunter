/**
 * PG Hunter — server reads of the plan catalogue.
 *
 * Server-only: imports the D1 binding, so this must never reach the browser.
 * The shared shape and fallbacks live in src/lib/plans.ts.
 */

import { getDb } from './auth';
import {
  FALLBACK_PLANS,
  normalisePlans,
  planFromRow,
  resolvePlan,
  type Plan,
  type PlanRow,
  type PlanSlug,
} from '../plans';

const SELECT_PLANS = `SELECT slug, name, tagline, price_inr, has_travel_charge,
                             duration_days, duration_label, features, checkout_note,
                             is_active, sort_order
                        FROM plans
                       WHERE is_active = 1
                    ORDER BY sort_order, slug`;

/**
 * Every sellable plan, in display order.
 *
 * Returns the known-good fallback catalogue if the table is missing or the query
 * fails, so a pricing page never renders an empty or fabricated price. The
 * failure is logged rather than swallowed, because a silent fallback would hide
 * a broken migration.
 */
export const getPlans = async (db?: D1Database): Promise<Plan[]> => {
  try {
    const res = await (db ?? getDb()).prepare(SELECT_PLANS).all<PlanRow>();
    const plans = normalisePlans(
      res.results.map(planFromRow).filter((p): p is Plan => p !== null)
    );
    return plans.length > 0 ? plans : [...FALLBACK_PLANS];
  } catch (err) {
    console.error('plans: catalogue read failed, serving known-good defaults', err);
    return [...FALLBACK_PLANS];
  }
};

/** One plan by slug, falling back to its known-good default. */
export const getPlan = async (slug: PlanSlug, db?: D1Database): Promise<Plan> =>
  resolvePlan(await getPlans(db), slug);

/** The default plan for a new listing — the free one. */
export const getDefaultPlan = async (db?: D1Database): Promise<Plan> =>
  resolvePlan(await getPlans(db), 'basic');
