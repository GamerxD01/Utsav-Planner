/**
 * Vendor checklists: who to book, when, and what to ask before paying a deposit.
 * @module checklist
 */
import { addDays } from './timeline.js';

/** @typedef {{ id: string, vendor: string, weeksBefore: number, questions: string[] }} VendorTemplate */

const COMMON_QUESTIONS = Object.freeze([
  'What exactly is included in the quote (taxes, staff, overtime)?',
  'What are the deposit, payment schedule and cancellation terms?',
]);

/** @type {Record<string, VendorTemplate[]>} */
export const VENDOR_TEMPLATES = Object.freeze({
  wedding: [
    { id: 'venue', vendor: 'Venue', weeksBefore: 40, questions: ['Is there a backup space for rain?', 'Is the venue step-free and accessible?', 'Are outside caterers or decorators allowed?'] },
    { id: 'caterer', vendor: 'Caterer', weeksBefore: 34, questions: ['Can we do a tasting before booking?', 'How do you handle allergies and dietary needs?', 'What is the per-plate price at our headcount?'] },
    { id: 'photo', vendor: 'Photographer & videographer', weeksBefore: 38, questions: ['Can we see two full wedding galleries?', 'When will edited photos be delivered?'] },
    { id: 'decor', vendor: 'Decorator & florist', weeksBefore: 26, questions: ['Which flowers are in season for our date?', 'Is setup and teardown included?'] },
    { id: 'music', vendor: 'DJ / band', weeksBefore: 17, questions: ['Do you bring your own sound and backup equipment?', 'What are the venue noise curfews?'] },
    { id: 'attire', vendor: 'Attire & makeup artist', weeksBefore: 21, questions: ['How many fittings / trials are included?'] },
    { id: 'transport', vendor: 'Guest transport', weeksBefore: 12, questions: ['Are vehicles insured and drivers licensed?'] },
  ],
  birthday: [
    { id: 'venue', vendor: 'Venue / party space', weeksBefore: 6, questions: ['What is the time slot and overtime charge?', 'Is the space child-safe and accessible?'] },
    { id: 'caterer', vendor: 'Food / caterer', weeksBefore: 3, questions: ['Can you label allergens on each dish?', 'What is the minimum order?'] },
    { id: 'cake', vendor: 'Baker', weeksBefore: 2, questions: ['Can you make it egg-free / nut-free if needed?', 'Is delivery included?'] },
    { id: 'entertainment', vendor: 'Entertainer / activities', weeksBefore: 2, questions: ['How long is the act and what space do you need?'] },
    { id: 'decor', vendor: 'Decor & balloons', weeksBefore: 2, questions: ['Do you offer reusable or eco-friendly decor?'] },
  ],
  community: [
    { id: 'venue', vendor: 'Venue / ground', weeksBefore: 10, questions: ['What is the safe crowd capacity?', 'Are toilets, ramps and drinking water available?'] },
    { id: 'permits', vendor: 'Local authority / permits', weeksBefore: 9, questions: ['Which permissions are needed (police, sound, fire)?', 'What are the processing times?'] },
    { id: 'sound', vendor: 'Sound & stage', weeksBefore: 6, questions: ['Is a generator backup included?', 'Who operates the equipment on the day?'] },
    { id: 'food', vendor: 'Food stalls / caterer', weeksBefore: 6, questions: ['Do vendors hold food-safety licences?', 'How will waste be handled?'] },
    { id: 'safety', vendor: 'First aid & security', weeksBefore: 3, questions: ['How many trained staff for our crowd size?'] },
    { id: 'supplies', vendor: 'Rentals & supplies', weeksBefore: 4, questions: ['Are tents, chairs and signage delivered and collected?'] },
  ],
});

/**
 * @typedef {object} VendorItem
 * @property {string} id
 * @property {string} vendor
 * @property {string} bookBy ISO date
 * @property {boolean} urgent
 * @property {string[]} questions
 * @property {string} tip
 */

/**
 * Build the vendor checklist, attaching AI tips where the vendor names match.
 * @param {{ eventType: string, eventDate: string, leadDays: number }} req
 * @param {{ vendor: string, tip: string }[]} [vendorTips]
 * @returns {VendorItem[]}
 */
export function buildChecklist(req, vendorTips = []) {
  const templates = VENDOR_TEMPLATES[req.eventType];
  if (!templates) throw new Error(`Unknown event type: ${req.eventType}`);

  const findTip = (/** @type {string} */ vendor) => {
    const name = vendor.toLowerCase();
    const match = vendorTips.find((t) => {
      const key = t.vendor.toLowerCase();
      return name.includes(key) || key.includes(name.split(/[ /&]/)[0]);
    });
    return match ? match.tip : '';
  };

  return templates
    .map((t) => {
      const idealDays = t.weeksBefore * 7;
      const daysBefore = Math.min(idealDays, Math.max(req.leadDays - 1, 0));
      return {
        id: t.id,
        vendor: t.vendor,
        bookBy: addDays(req.eventDate, -daysBefore),
        urgent: idealDays > req.leadDays,
        questions: [...t.questions, ...COMMON_QUESTIONS],
        tip: findTip(t.vendor),
      };
    })
    .sort((a, b) => a.bookBy.localeCompare(b.bookBy));
}
