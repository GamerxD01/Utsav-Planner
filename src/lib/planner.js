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
      { title: 'Personal welcome wall', description: 'Display photos from both families’ journeys at the entrance to spark conversation.', category: 'guest-experience' },
      { title: 'Regional live counters', description: 'Feature live food counters from both families’ home regions to celebrate heritage.', category: 'food' },
      { title: 'Reusable floral installations', description: 'Use potted plants and rented installations that guests or the venue can reuse.', category: 'sustainability' },
      { title: 'Family storytelling segment', description: 'Invite elders to share a short story or blessing during the reception.', category: 'entertainment' },
    ],
    budgetTips: ['Lock the guest list first — headcount drives most costs.', 'Choose a weekday or off-season date for better venue rates.', 'Bundle decor and lighting with one vendor to negotiate a package.'],
    risks: ['Weather on outdoor functions — reserve an indoor backup.', 'Vendor no-shows — keep signed contracts and a backup contact list.'],
  },
  birthday: {
    ideas: [
      { title: 'Memory lane timeline', description: 'Create a photo timeline of the guest of honour’s milestones.', category: 'theme' },
      { title: 'DIY dessert bar', description: 'Let guests build their own desserts with labelled toppings, including allergy-safe options.', category: 'food' },
      { title: 'Group activity', description: 'Plan one shared activity — karaoke, a quiz about the birthday person, or a craft station.', category: 'entertainment' },
      { title: 'Plantable return gifts', description: 'Give seed paper cards or saplings instead of plastic favours.', category: 'sustainability' },
    ],
    budgetTips: ['Host at home or a community hall to save on venue costs.', 'Order a smaller display cake plus a sheet cake for serving.', 'Use digital invitations instead of printed ones.'],
    risks: ['Allergies — label every dish and ask guests in the RSVP.', 'Overcrowding — cap the guest list to the space.'],
  },
  community: {
    ideas: [
      { title: 'Local talent stage', description: 'Give residents short slots to perform, building ownership of the event.', category: 'entertainment' },
      { title: 'Zero-waste stations', description: 'Set up segregated bins with volunteers to guide guests.', category: 'sustainability' },
      { title: 'Accessible zone', description: 'Reserve shaded seating near the stage for elders and wheelchair users.', category: 'guest-experience' },
      { title: 'Potluck food street', description: 'Invite households or local vendors to run themed food stalls.', category: 'food' },
    ],
    budgetTips: ['Approach local businesses for in-kind sponsorship.', 'Borrow chairs and tents from community associations.', 'Recruit volunteers early to reduce paid staff.'],
    risks: ['Missing permits — apply early and keep copies on site.', 'Crowd safety — plan entry, exit and first-aid points.'],
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
 * Assemble the final plan object.
 * @param {import('./validation.js').PlanRequest} req
 * @param {ReturnType<typeof normalizeAiPlan> | null} ai
 */
export function assemblePlan(req, ai) {
  const fallback = FALLBACK_CONTENT[req.eventType];
  const useAi = Boolean(ai && ai.ideas.length > 0);
  const budget = buildBudget(req);
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
    summary: useAi && ai?.summary
      ? ai.summary
      : `A ${req.eventType} plan for ${req.guestCount} guests in ${req.leadDays} days, with about ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: req.currency, maximumFractionDigits: 0 }).format(budget.perGuest)} per guest.`,
    budget,
    timeline: buildTimeline(req, useAi && ai ? ai.extraTasks : []),
    checklist: buildChecklist(req, useAi && ai ? ai.vendorTips : []),
    ideas: useAi && ai ? ai.ideas : fallback.ideas,
    budgetTips: useAi && ai && ai.budgetTips.length ? ai.budgetTips : fallback.budgetTips,
    risks: useAi && ai && ai.risks.length ? ai.risks : fallback.risks,
    source: useAi ? 'gemini' : 'fallback',
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
    let ai = null;
    if (gemini.enabled) {
      try {
        const raw = await gemini.generateJson({
          system: SYSTEM_INSTRUCTION,
          prompt: buildUserPrompt(req, buildBudget(req)),
          schema: RESPONSE_SCHEMA,
        });
        ai = normalizeAiPlan(raw);
      } catch (error) {
        logger.warn(JSON.stringify({ severity: 'WARNING', message: 'Gemini unavailable, using fallback', error: String(error) }));
      }
    }
    return assemblePlan(req, ai);
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
