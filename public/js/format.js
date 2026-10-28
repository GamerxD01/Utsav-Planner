/**
 * Pure, DOM-free helpers shared by the browser UI and the Node test suite.
 * @module format
 */

/**
 * Format a whole-number amount in a currency.
 * @param {number} amount
 * @param {string} currency ISO 4217 code
 * @param {string} [locale]
 */
export function formatMoney(amount, currency, locale = currency === 'INR' ? 'en-IN' : 'en-US') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

/**
 * Human-readable date for an ISO (YYYY-MM-DD) string, timezone-safe.
 * @param {string} iso
 * @param {string} [locale]
 */
export function formatDate(iso, locale = 'en-IN') {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${iso}T00:00:00Z`));
}

/**
 * Escape text per RFC 5545 §3.3.11.
 * @param {string} text
 */
export function escapeIcsText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/**
 * Fold long content lines to 75 octets as required by RFC 5545 (approximated by chars).
 * @param {string} line
 */
export function foldIcsLine(line) {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(` ${line.slice(i, i + 74)}`);
  return parts.join('\r\n');
}

/**
 * Build an iCalendar file with an all-day entry per timeline task plus the event itself.
 * @param {{ event: { type: string, name?: string, date: string }, timeline: { phase: string, tasks: { id: string, text: string, dueDate: string }[] }[] }} plan
 * @param {Date} [now]
 * @returns {string}
 */
export function buildIcs(plan, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const compact = (/** @type {string} */ iso) => iso.replace(/-/g, '');
  const nextDay = (/** @type {string} */ iso) => compact(new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10));
  const title = plan.event.name || `My ${plan.event.type}`;

  const events = [
    { uid: 'event', summary: `🎉 ${title}`, date: plan.event.date, description: 'Event day' },
    ...plan.timeline.flatMap((phase) => phase.tasks.map((t) => ({ uid: t.id, summary: t.text, date: t.dueDate, description: phase.phase }))),
  ];

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Utsav AI Planner//EN',
    'CALSCALE:GREGORIAN',
    ...events.flatMap((e) => [
      'BEGIN:VEVENT',
      `UID:${e.uid}-${compact(plan.event.date)}@utsav-planner`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(e.date)}`,
      `DTEND;VALUE=DATE:${nextDay(e.date)}`,
      `SUMMARY:${escapeIcsText(e.summary)}`,
      `DESCRIPTION:${escapeIcsText(`${title} — ${e.description}`)}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

/**
 * Storage key so checklist progress survives reloads for the same event.
 * @param {{ event: { type: string, date: string, name?: string } }} plan
 */
export function progressKey(plan) {
  return `utsav:progress:${plan.event.type}:${plan.event.date}:${plan.event.name ?? ''}`;
}

/**
 * Collect form values into the API payload shape.
 * @param {Record<string, string | string[]>} values
 */
export function toPayload(values) {
  const one = (/** @type {string} */ k) => {
    const v = values[k];
    return Array.isArray(v) ? v[0] ?? '' : v ?? '';
  };
  const many = values.priorities;
  return {
    eventType: one('eventType'),
    eventName: one('eventName').trim(),
    eventDate: one('eventDate'),
    guestCount: Number(one('guestCount')),
    budget: Number(one('budget')),
    currency: one('currency') || 'INR',
    city: one('city').trim(),
    theme: one('theme').trim(),
    priorities: Array.isArray(many) ? many : many ? [many] : [],
    notes: one('notes').trim(),
  };
}

/**
 * Client-side validation mirroring the server rules (the server stays authoritative).
 * @param {ReturnType<typeof toPayload>} p
 * @param {string} today ISO date
 * @returns {Record<string, string>}
 */
export function validatePayload(p, today) {
  /** @type {Record<string, string>} */
  const errors = {};
  if (!p.eventDate) errors.eventDate = 'Enter the event date.';
  else if (p.eventDate < today) errors.eventDate = 'The event date must be today or later.';
  if (!Number.isInteger(p.guestCount) || p.guestCount < 1 || p.guestCount > 5000) {
    errors.guestCount = 'Enter a whole number of guests between 1 and 5000.';
  }
  if (!Number.isFinite(p.budget) || p.budget < 100) errors.budget = 'Enter a total budget of at least 100.';
  if (p.priorities.length > 3) errors.priorities = 'Pick at most 3 priorities.';
  return errors;
}
