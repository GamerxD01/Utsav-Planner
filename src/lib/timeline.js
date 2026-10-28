/**
 * Deterministic timeline generation. Ideal lead times are compressed proportionally
 * when the event is sooner than ideal, and those tasks are flagged as urgent.
 * @module timeline
 */

const DAY_MS = 86_400_000;

/** @typedef {{ id: string, text: string, daysBefore: number }} TaskTemplate */

/** @type {Record<string, TaskTemplate[]>} */
export const TASK_TEMPLATES = Object.freeze({
  wedding: [
    { id: 'w-budget', text: 'Agree on total budget and who contributes', daysBefore: 365 },
    { id: 'w-guests', text: 'Draft the guest list with both families', daysBefore: 330 },
    { id: 'w-venue', text: 'Shortlist, visit and book the venue', daysBefore: 300 },
    { id: 'w-photo', text: 'Book photographer and videographer', daysBefore: 270 },
    { id: 'w-caterer', text: 'Run tastings and book the caterer', daysBefore: 240 },
    { id: 'w-decor', text: 'Finalise decorator and floral concept', daysBefore: 180 },
    { id: 'w-attire', text: 'Order wedding attire (allow for alterations)', daysBefore: 150 },
    { id: 'w-invites', text: 'Send save-the-dates / digital invites', daysBefore: 120 },
    { id: 'w-music', text: 'Book DJ, band or musicians', daysBefore: 120 },
    { id: 'w-stay', text: 'Block hotel rooms and plan guest transport', daysBefore: 90 },
    { id: 'w-rsvp', text: 'Chase RSVPs and confirm final headcount', daysBefore: 30 },
    { id: 'w-runsheet', text: 'Share the day-of run sheet with all vendors', daysBefore: 7 },
    { id: 'w-pay', text: 'Prepare final vendor payments and tips', daysBefore: 3 },
    { id: 'w-day', text: 'Celebrate — hand coordination to your point person', daysBefore: 0 },
    { id: 'w-thanks', text: 'Send thank-you notes and settle balances', daysBefore: -14 },
  ],
  birthday: [
    { id: 'b-budget', text: 'Set the budget and party format', daysBefore: 60 },
    { id: 'b-guests', text: 'Draft the guest list', daysBefore: 50 },
    { id: 'b-venue', text: 'Book the venue or prepare the home space', daysBefore: 45 },
    { id: 'b-invites', text: 'Send invitations with RSVP date', daysBefore: 30 },
    { id: 'b-food', text: 'Book caterer or plan the menu', daysBefore: 21 },
    { id: 'b-cake', text: 'Order the cake (note allergies)', daysBefore: 14 },
    { id: 'b-fun', text: 'Book entertainment / plan activities', daysBefore: 14 },
    { id: 'b-decor', text: 'Buy decorations and return gifts', daysBefore: 10 },
    { id: 'b-rsvp', text: 'Confirm headcount with RSVPs', daysBefore: 5 },
    { id: 'b-setup', text: 'Set up decor and test music', daysBefore: 1 },
    { id: 'b-day', text: 'Party time — assign a photo helper', daysBefore: 0 },
    { id: 'b-thanks', text: 'Share photos and thank guests', daysBefore: -3 },
  ],
  community: [
    { id: 'c-goals', text: 'Define purpose, audience and success metrics', daysBefore: 90 },
    { id: 'c-team', text: 'Form an organising committee with clear roles', daysBefore: 80 },
    { id: 'c-venue', text: 'Book the venue and check capacity / accessibility', daysBefore: 70 },
    { id: 'c-permits', text: 'Apply for local permits, police and sound clearances', daysBefore: 60 },
    { id: 'c-sponsors', text: 'Reach out to sponsors and local partners', daysBefore: 60 },
    { id: 'c-vendors', text: 'Book food stalls, sound and supplies', daysBefore: 45 },
    { id: 'c-promo', text: 'Launch promotion (social, posters, RWA groups)', daysBefore: 30 },
    { id: 'c-volunteers', text: 'Recruit and brief volunteers', daysBefore: 21 },
    { id: 'c-safety', text: 'Finalise safety, first-aid and crowd plan', daysBefore: 14 },
    { id: 'c-runsheet', text: 'Share run sheet and volunteer shifts', daysBefore: 3 },
    { id: 'c-day', text: 'Event day — run check-in and feedback collection', daysBefore: 0 },
    { id: 'c-report', text: 'Publish thank-you post and impact report', daysBefore: -7 },
  ],
});

/** Phase windows, checked in order (days before the event, inclusive lower bound). */
const PHASES = [
  { min: 180, label: '6+ months before' },
  { min: 90, label: '3–6 months before' },
  { min: 30, label: '1–3 months before' },
  { min: 7, label: 'Final weeks' },
  { min: 1, label: 'Event week' },
  { min: 0, label: 'Event day' },
  { min: -Infinity, label: 'After the event' },
];

/**
 * @param {number} daysBefore
 * @returns {string}
 */
export function phaseFor(daysBefore) {
  return /** @type {{label: string}} */ (PHASES.find((p) => daysBefore >= p.min)).label;
}

/**
 * Add whole days to an ISO date.
 * @param {string} isoDate
 * @param {number} days
 */
export function addDays(isoDate, days) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * @typedef {object} TimelineTask
 * @property {string} id
 * @property {string} text
 * @property {string} dueDate
 * @property {boolean} urgent
 * @property {'template'|'ai'} source
 */

/**
 * Build a phased timeline.
 * @param {{ eventType: string, eventDate: string, leadDays: number }} req
 * @param {{ task: string, weeksBefore: number }[]} [extraTasks] AI-suggested additions
 * @returns {{ phase: string, tasks: TimelineTask[] }[]}
 */
export function buildTimeline(req, extraTasks = []) {
  const templates = TASK_TEMPLATES[req.eventType];
  if (!templates) throw new Error(`Unknown event type: ${req.eventType}`);

  const all = [
    ...templates.map((t) => ({ ...t, source: /** @type {const} */ ('template') })),
    ...extraTasks.map((t, i) => ({
      id: `ai-${i}`,
      text: t.task,
      daysBefore: Math.round(t.weeksBefore * 7),
      source: /** @type {const} */ ('ai'),
    })),
  ];

  const maxBefore = Math.max(...all.map((t) => t.daysBefore));
  const compression = maxBefore > req.leadDays && maxBefore > 0 ? req.leadDays / maxBefore : 1;

  const tasks = all
    .map((t) => {
      const scheduled = t.daysBefore > 0 ? Math.floor(t.daysBefore * compression) : t.daysBefore;
      return {
        id: t.id,
        text: t.text,
        daysBefore: scheduled,
        dueDate: addDays(req.eventDate, -scheduled),
        urgent: t.daysBefore > req.leadDays,
        source: t.source,
      };
    })
    .sort((a, b) => b.daysBefore - a.daysBefore);

  /** @type {Map<string, TimelineTask[]>} */
  const grouped = new Map();
  for (const { daysBefore, ...task } of tasks) {
    const phase = phaseFor(daysBefore);
    if (!grouped.has(phase)) grouped.set(phase, []);
    /** @type {TimelineTask[]} */ (grouped.get(phase)).push(task);
  }
  return [...grouped.entries()].map(([phase, list]) => ({ phase, tasks: list }));
}
