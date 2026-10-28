/**
 * Domain constants shared by validation, the planning engine and the prompt.
 * @module constants
 */

export const EVENT_TYPES = Object.freeze(['wedding', 'birthday', 'community']);

export const CURRENCIES = Object.freeze(['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD']);

/** Priorities a user can pick (max 3) to shift budget weight. */
export const PRIORITIES = Object.freeze([
  'venue',
  'food',
  'decor',
  'entertainment',
  'photography',
  'attire',
  'guest-experience',
  'sustainability',
]);

export const LIMITS = Object.freeze({
  minGuests: 1,
  maxGuests: 5000,
  minBudget: 100,
  maxBudget: 1_000_000_000,
  maxPriorities: 3,
  maxLeadDays: 3 * 365,
  text: Object.freeze({ eventName: 80, city: 80, theme: 120, notes: 500 }),
});

/**
 * Human labels for budget categories.
 * @type {Readonly<Record<string, string>>}
 */
export const CATEGORY_LABELS = Object.freeze({
  venue: 'Venue & rentals',
  food: 'Food & beverages',
  decor: 'Decor & flowers',
  entertainment: 'Music & entertainment',
  photography: 'Photo & video',
  attire: 'Attire & styling',
  invitations: 'Invitations & stationery',
  favors: 'Gifts & favours',
  logistics: 'Transport & logistics',
  permits: 'Permits, safety & insurance',
  supplies: 'Supplies & activities',
  cake: 'Cake & desserts',
  contingency: 'Contingency buffer',
});

/**
 * Baseline budget weights per event type (sum to 1, contingency included).
 * Sourced from common planning rules of thumb; personalised by priorities.
 */
export const BUDGET_WEIGHTS = Object.freeze({
  wedding: Object.freeze({
    venue: 0.22,
    food: 0.28,
    decor: 0.1,
    photography: 0.1,
    attire: 0.08,
    entertainment: 0.06,
    invitations: 0.03,
    favors: 0.03,
    logistics: 0.02,
    contingency: 0.08,
  }),
  birthday: Object.freeze({
    venue: 0.2,
    food: 0.32,
    cake: 0.08,
    decor: 0.12,
    entertainment: 0.1,
    photography: 0.05,
    favors: 0.05,
    invitations: 0.02,
    contingency: 0.06,
  }),
  community: Object.freeze({
    venue: 0.2,
    food: 0.25,
    permits: 0.08,
    supplies: 0.12,
    entertainment: 0.1,
    logistics: 0.08,
    decor: 0.05,
    photography: 0.04,
    contingency: 0.08,
  }),
});

/**
 * Maps each priority to the budget category it boosts (some are redirected, e.g. sustainability → decor).
 * @type {Readonly<Record<string, string>>}
 */
export const PRIORITY_TO_CATEGORY = Object.freeze({
  venue: 'venue',
  food: 'food',
  decor: 'decor',
  entertainment: 'entertainment',
  photography: 'photography',
  attire: 'attire',
  'guest-experience': 'favors',
  sustainability: 'decor',
});
