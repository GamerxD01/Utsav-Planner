/**
 * Strict input validation and sanitisation for plan requests.
 * Untrusted input never reaches the planner or the LLM prompt without passing here.
 * @module validation
 */
import { CURRENCIES, EVENT_TYPES, LIMITS, PRIORITIES } from './constants.js';

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Control characters (except tab/newline) and angle brackets are stripped from free text.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F<>]/g;

/**
 * Trim, strip unsafe characters, collapse whitespace and cap length.
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {string}
 */
export function sanitizeText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .replace(UNSAFE_CHARS, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * Parse a YYYY-MM-DD string into a UTC midnight Date, rejecting impossible dates.
 * @param {unknown} value
 * @returns {Date | null}
 */
export function parseIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

/**
 * Midnight UTC for a given instant.
 * @param {Date} now
 */
export function startOfUtcDay(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * @typedef {object} PlanRequest
 * @property {'wedding'|'birthday'|'community'} eventType
 * @property {string} eventName
 * @property {string} eventDate  ISO date (YYYY-MM-DD)
 * @property {number} leadDays   whole days from today until the event
 * @property {number} guestCount
 * @property {number} budget
 * @property {string} currency
 * @property {string} city
 * @property {string} theme
 * @property {string[]} priorities
 * @property {string} notes
 */

/**
 * Validate a raw request body.
 * @param {unknown} body
 * @param {Date} [now]
 * @returns {{ ok: true, value: PlanRequest } | { ok: false, errors: Record<string, string> }}
 */
export function validatePlanRequest(body, now = new Date()) {
  /** @type {Record<string, string>} */
  const errors = {};
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: { body: 'Request body must be a JSON object.' } };
  }
  const input = /** @type {Record<string, unknown>} */ (body);

  const eventType = typeof input.eventType === 'string' ? input.eventType.toLowerCase() : '';
  if (!EVENT_TYPES.includes(eventType)) {
    errors.eventType = `Choose one of: ${EVENT_TYPES.join(', ')}.`;
  }

  const date = parseIsoDate(input.eventDate);
  let leadDays = 0;
  if (!date) {
    errors.eventDate = 'Enter a valid date (YYYY-MM-DD).';
  } else {
    leadDays = Math.round((date.getTime() - startOfUtcDay(now).getTime()) / DAY_MS);
    if (leadDays < 0) errors.eventDate = 'The event date must be today or later.';
    else if (leadDays > LIMITS.maxLeadDays) errors.eventDate = 'Plan events up to 3 years ahead.';
  }

  const guestCount = Number(input.guestCount);
  if (!Number.isInteger(guestCount) || guestCount < LIMITS.minGuests || guestCount > LIMITS.maxGuests) {
    errors.guestCount = `Guests must be a whole number between ${LIMITS.minGuests} and ${LIMITS.maxGuests}.`;
  }

  const budget = Number(input.budget);
  if (!Number.isFinite(budget) || budget < LIMITS.minBudget || budget > LIMITS.maxBudget) {
    errors.budget = `Budget must be between ${LIMITS.minBudget} and ${LIMITS.maxBudget.toLocaleString('en-US')}.`;
  }

  const currency = typeof input.currency === 'string' ? input.currency.toUpperCase() : 'INR';
  if (!CURRENCIES.includes(currency)) {
    errors.currency = `Currency must be one of: ${CURRENCIES.join(', ')}.`;
  }

  /** @type {string[]} */
  let priorities = [];
  if (input.priorities !== undefined) {
    if (!Array.isArray(input.priorities)) {
      errors.priorities = 'Priorities must be a list.';
    } else {
      priorities = [...new Set(input.priorities.filter((p) => typeof p === 'string'))];
      if (priorities.some((p) => !PRIORITIES.includes(p))) {
        errors.priorities = 'One or more priorities are not recognised.';
      } else if (priorities.length > LIMITS.maxPriorities) {
        errors.priorities = `Pick at most ${LIMITS.maxPriorities} priorities.`;
      }
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      eventType: /** @type {PlanRequest['eventType']} */ (eventType),
      eventName: sanitizeText(input.eventName, LIMITS.text.eventName),
      eventDate: /** @type {string} */ (input.eventDate),
      leadDays,
      guestCount,
      budget: Math.round(budget),
      currency,
      city: sanitizeText(input.city, LIMITS.text.city),
      theme: sanitizeText(input.theme, LIMITS.text.theme),
      priorities,
      notes: sanitizeText(input.notes, LIMITS.text.notes),
    },
  };
}
