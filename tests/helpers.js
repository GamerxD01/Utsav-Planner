/** Shared fixtures for the test suite. */

export const NOW = new Date('2026-10-28T09:00:00Z');

/** @param {Record<string, unknown>} [overrides] */
export function validBody(overrides = {}) {
  return {
    eventType: 'wedding',
    eventName: 'Aisha & Rohan',
    eventDate: '2027-10-28',
    guestCount: 250,
    budget: 1_500_000,
    currency: 'INR',
    city: 'Lucknow',
    theme: 'Pastel garden',
    priorities: ['food', 'photography'],
    notes: 'Mostly vegetarian guests, one wheelchair user.',
    ...overrides,
  };
}

/** A well-formed AI response matching RESPONSE_SCHEMA. */
export const AI_RESPONSE = Object.freeze({
  summary: 'A warm pastel garden wedding for 250 guests in Lucknow.',
  ideas: [
    { title: 'Awadhi live counters', description: 'Kebab and biryani stations with vegetarian galouti.', category: 'food' },
    { title: 'Garden ceremony arch', description: 'Pastel florals with reusable frames.', category: 'decor' },
    { title: 'Ramp-first layout', description: 'Step-free paths for all guests.', category: 'unknown-category' },
    { title: '', description: 'dropped: no title', category: 'theme' },
  ],
  budgetTips: ['Use seasonal flowers', 'Negotiate packages'],
  vendorTips: [{ vendor: 'Caterer', tip: 'Ask for a Jain menu option.' }, { vendor: 'Venue', tip: 'Confirm ramp access.' }],
  extraTasks: [{ task: 'Book mehendi artist', weeksBefore: 8 }, { task: 'bad', weeksBefore: -1 }],
  risks: ['Monsoon rain risk — keep an indoor backup.'],
});

/** Fake Gemini client. */
export function fakeGemini({ enabled = true, response = AI_RESPONSE, fail = false } = {}) {
  const calls = [];
  return {
    enabled,
    model: 'fake',
    calls,
    async generateJson(input) {
      calls.push(input);
      if (fail) throw new Error('boom');
      return structuredClone(response);
    },
  };
}

export const silentLogger = { info() {}, warn() {}, error() {} };
