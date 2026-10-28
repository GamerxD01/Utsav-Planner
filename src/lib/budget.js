/**
 * Deterministic budget allocation. Runs without the LLM so totals are always exact.
 * @module budget
 */
import { BUDGET_WEIGHTS, CATEGORY_LABELS, PRIORITY_TO_CATEGORY } from './constants.js';

export const PRIORITY_BOOST = 1.5;
const NEW_CATEGORY_WEIGHT = 0.04;

/**
 * Compute normalised category weights for an event, boosting the user's priorities
 * while keeping the contingency share fixed.
 * @param {keyof typeof BUDGET_WEIGHTS} eventType
 * @param {string[]} priorities
 * @returns {Record<string, number>}
 */
export function computeWeights(eventType, priorities = []) {
  const base = BUDGET_WEIGHTS[eventType];
  if (!base) throw new Error(`Unknown event type: ${eventType}`);
  const { contingency = 0, ...rest } = base;

  /** @type {Record<string, number>} */
  const weights = { ...rest };
  for (const priority of priorities) {
    const category = PRIORITY_TO_CATEGORY[priority];
    if (!category) continue;
    weights[category] = (weights[category] ?? NEW_CATEGORY_WEIGHT) * PRIORITY_BOOST;
  }

  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  const scale = (1 - contingency) / sum;
  for (const key of Object.keys(weights)) weights[key] *= scale;
  weights.contingency = contingency;
  return weights;
}

/**
 * Split an integer total across weights so the parts sum exactly to the total
 * (largest-remainder method).
 * @param {number} total
 * @param {Record<string, number>} weights
 * @returns {Record<string, number>}
 */
export function allocate(total, weights) {
  const entries = Object.entries(weights);
  const raw = entries.map(([key, w]) => ({ key, exact: total * w }));
  const floored = raw.map((r) => ({ ...r, amount: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
  let leftover = total - floored.reduce((a, r) => a + r.amount, 0);
  [...floored]
    .sort((a, b) => b.rem - a.rem)
    .forEach((r) => {
      if (leftover > 0) {
        r.amount += 1;
        leftover -= 1;
      }
    });
  return Object.fromEntries(floored.map((r) => [r.key, r.amount]));
}

/**
 * @typedef {object} BudgetLine
 * @property {string} category
 * @property {string} label
 * @property {number} amount
 * @property {number} percent  one decimal place
 * @property {boolean} prioritized
 */

/**
 * Build the full budget breakdown for a validated request.
 * @param {{ eventType: keyof typeof BUDGET_WEIGHTS, budget: number, guestCount: number, currency: string, priorities: string[] }} req
 */
export function buildBudget(req) {
  const weights = computeWeights(req.eventType, req.priorities);
  const amounts = allocate(req.budget, weights);
  const boosted = new Set(req.priorities.map((p) => PRIORITY_TO_CATEGORY[p]));

  /** @type {BudgetLine[]} */
  const lines = Object.keys(weights)
    .map((category) => ({
      category,
      label: CATEGORY_LABELS[category] ?? category,
      amount: amounts[category],
      percent: Math.round((amounts[category] / req.budget) * 1000) / 10,
      prioritized: boosted.has(category),
    }))
    .sort((a, b) => Number(a.category === 'contingency') - Number(b.category === 'contingency') || b.amount - a.amount);

  return {
    total: req.budget,
    currency: req.currency,
    perGuest: Math.round(req.budget / req.guestCount),
    lines,
  };
}
