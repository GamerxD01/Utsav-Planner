/**
 * Orchestrates a plan: deterministic engine (budget, timeline, checklist) +
 * Gemini personalisation, with caching, in-flight de-duplication and graceful fallback.
 * @module planner
 */
import { createHash } from 'node:crypto';
import { buildBudget } from './budget.js';
import { buildChecklist } from './checklist.js';
import { buildTimeline } from './timeline.js';
import { RESPONSE_SCHEMA, SYSTEM_INSTRUCTION, buildUserPrompt, normalizeAiPlan } from './prompt.js';

/** Curated suggestions used when Gemini is unavailable, so the app never dead-ends. */
export const FALLBACK_CONTENT = Object.freeze({
  wedding: {
    ideas: [
      {
        title: 'Personal welcome wall',
        description: 'Display photos from both families’ journeys at the entrance to spark conversation.',
        category: 'guest-experience',
      },
      {
        title: 'Regional live counters',
        description: 'Feature live food counters from both families’ home regions to celebrate heritage.',
        category: 'food',
      },
      {
        title: 'Reusable floral installations',
        description: 'Use potted plants and rented installations that guests or the venue can reuse.',
        category: 'sustainability',
      },
      {
        title: 'Family storytelling segment',
        description: 'Invite elders to share a short story or blessing during the reception.',
        category: 'entertainment',
      },
    ],
    budgetTips: [
      'Lock the guest list first — headcount drives most costs.',
      'Choose a weekday or off-season date for better venue rates.',
      'Bundle decor and lighting with one vendor to negotiate a package.',
    ],
    risks: [
      'Weather on outdoor functions — reserve an indoor backup.',
      'Vendor no-shows — keep signed contracts and a backup contact list.',
    ],
  },
  birthday: {
    ideas: [
      {
        title: 'Memory lane timeline',
        description: 'Create a photo timeline of the guest of honour’s milestones.',
        category: 'theme',
      },
      {
        title: 'DIY dessert bar',
        description: 'Let guests build their own desserts with labelled toppings, including allergy-safe options.',
        category: 'food',
      },
      {
        title: 'Group activity',
        description: 'Plan one shared activity — karaoke, a quiz about the birthday person, or a craft station.',
        category: 'entertainment',
      },
      {
        title: 'Plantable return gifts',
        description: 'Give seed paper cards or saplings instead of plastic favours.',
        category: 'sustainability',
      },
    ],
    budgetTips: [
      'Host at home or a community hall to save on venue costs.',
      'Order a smaller display cake plus a sheet cake for serving.',
      'Use digital invitations instead of printed ones.',
    ],
    risks: [
      'Allergies — label every dish and ask guests in the RSVP.',
      'Overcrowding — cap the guest list to the space.',
    ],
  },
  community: {
    ideas: [
      {
        title: 'Local talent stage',
        description: 'Give residents short slots to perform, building ownership of the event.',
        category: 'entertainment',
      },
      {
        title: 'Zero-waste stations',
        description: 'Set up segregated bins with volunteers to guide guests.',
        category: 'sustainability',
      },
      {
        title: 'Accessible zone',
        description: 'Reserve shaded seating near the stage for elders and wheelchair users.',
        category: 'guest-experience',
      },
      {
        title: 'Potluck food street',
        description: 'Invite households or local vendors to run themed food stalls.',
        category: 'food',
      },
    ],
    budgetTips: [
      'Approach local businesses for in-kind sponsorship.',
      'Borrow chairs and tents from community associations.',
      'Recruit volunteers early to reduce paid staff.',
    ],
    risks: [
      'Missing permits — apply early and keep copies on site.',
      'Crowd safety — plan entry, exit and first-aid points.',
    ],
  },
});

/**
 * Stable cache key from the validated request.
 * @param {object} req
 */
export function cacheKey(req) {
  return createHash('sha256').update(JSON.stringify(req)).digest('hex');
}

/**
 * Prefer a non-empty AI list, otherwise fall back to curated content.
 * @template T
 * @param {T[] | undefined} list
 * @param {T[]} fallback
 * @returns {T[]}
 */
const preferNonEmpty = (list, fallback) => (list && list.length > 0 ? list : fallback);

/**
 * Deterministic one-line summary used when Gemini is unavailable.
 * @param {import('./validation.js').PlanRequest} req
 * @param {number} perGuest
 */
export function fallbackSummary(req, perGuest) {
  const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: req.currency, maximumFractionDigits: 0 });
  return `A ${req.eventType} plan for ${req.guestCount} guests in ${req.leadDays} days, with about ${money.format(perGuest)} per guest.`;
}

/**
 * Assemble the final plan: deterministic budget, timeline and checklist, enriched
 * with Gemini's output when it is usable.
 * @param {import('./validation.js').PlanRequest} req
 * @param {ReturnType<typeof normalizeAiPlan> | null} ai
 * @param {ReturnType<typeof buildBudget>} [budget] pass in when already computed
 */
export function assemblePlan(req, ai, budget = buildBudget(req)) {
  const fallback = FALLBACK_CONTENT[req.eventType];
  // AI output only counts as personalised when it produced at least one idea.
  const personal = ai && ai.ideas.length > 0 ? ai : null;
  return {
    event: {
      type: req.eventType,
      name: req.eventName,
      date: req.eventDate,
      daysUntil: req.leadDays,
      guestCount: req.guestCount,
      city: req.city,
      theme: req.theme,
    },
    summary: personal?.summary || fallbackSummary(req, budget.perGuest),
    budget,
    timeline: buildTimeline(req, personal?.extraTasks ?? []),
    checklist: buildChecklist(req, personal?.vendorTips ?? []),
    ideas: preferNonEmpty(personal?.ideas, fallback.ideas),
    budgetTips: preferNonEmpty(personal?.budgetTips, fallback.budgetTips),
    risks: preferNonEmpty(personal?.risks, fallback.risks),
    source: personal ? 'gemini' : 'fallback',
  };
}

/**
 * @param {{ gemini: ReturnType<typeof import('./gemini.js').createGeminiClient>, cache: import('./cache.js').LruCache<any>, logger?: Pick<Console, 'warn'> }} deps
 */
export function createPlanner({ gemini, cache, logger = console }) {
  /** @type {Map<string, Promise<any>>} */
  const inFlight = new Map();

  /**
   * @param {import('./validation.js').PlanRequest} req
   */
  async function generate(req) {
    const budget = buildBudget(req);
    return assemblePlan(req, await personalise(req, budget), budget);
  }

  /**
   * Ask Gemini for personalised content; returns null (never throws) so the caller
   * can always fall back to curated suggestions.
   * @param {import('./validation.js').PlanRequest} req
   * @param {ReturnType<typeof buildBudget>} budget
   */
  async function personalise(req, budget) {
    if (!gemini.enabled) return null;
    try {
      const raw = await gemini.generateJson({
        system: SYSTEM_INSTRUCTION,
        prompt: buildUserPrompt(req, budget),
        schema: RESPONSE_SCHEMA,
      });
      return normalizeAiPlan(raw);
    } catch (error) {
      logger.warn(
        JSON.stringify({ severity: 'WARNING', message: 'Gemini unavailable, using fallback', error: String(error) }),
      );
      return null;
    }
  }

  return {
    /**
     * @param {import('./validation.js').PlanRequest} req
     * @returns {Promise<{ plan: ReturnType<typeof assemblePlan>, cached: boolean }>}
     */
    async plan(req) {
      const key = cacheKey(req);
      const hit = cache.get(key);
      if (hit) return { plan: hit, cached: true };

      let pending = inFlight.get(key);
      if (!pending) {
        pending = generate(req).finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
      }
      const plan = await pending;
      // Only cache AI results; a fallback should be retried next time.
      if (plan.source === 'gemini') cache.set(key, plan);
      return { plan, cached: false };
    },
  };
}
