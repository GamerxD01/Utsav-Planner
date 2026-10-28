import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildIcs, escapeIcsText, foldIcsLine, formatDate, formatMoney, progressKey, toPayload, validatePayload } from '../public/js/format.js';

const plan = {
  event: { type: 'birthday', name: 'Maya turns 30', date: '2026-12-12' },
  timeline: [{ phase: 'Final weeks', tasks: [{ id: 'b-cake', text: 'Order the cake, nut-free; chocolate', dueDate: '2026-11-28' }] }],
};

describe('front-end formatting helpers', () => {
  it('formats money and dates', () => {
    assert.equal(formatMoney(150000, 'INR'), '₹1,50,000');
    assert.equal(formatMoney(2500, 'USD'), '$2,500');
    assert.equal(formatDate('2026-12-12'), '12 Dec 2026');
  });

  it('escapes and folds iCalendar text', () => {
    assert.equal(escapeIcsText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
    const folded = foldIcsLine('x'.repeat(200));
    assert.ok(folded.split('\r\n').every((line) => line.length <= 75));
  });

  it('builds a valid all-day calendar', () => {
    const ics = buildIcs(plan, new Date('2026-10-28T00:00:00Z'));
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
    assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
    assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
    assert.match(ics, /DTSTART;VALUE=DATE:20261128/);
    assert.match(ics, /DTEND;VALUE=DATE:20261129/);
    assert.match(ics, /SUMMARY:Order the cake\\, nut-free\\; chocolate/);
  });

  it('creates a stable progress key', () => {
    assert.equal(progressKey(plan), 'utsav:progress:birthday:2026-12-12:Maya turns 30');
  });

  it('maps form values to the API payload', () => {
    const payload = toPayload({ eventType: 'wedding', eventDate: '2027-01-01', guestCount: '100', budget: '50000', priorities: 'food', notes: '  hi ' });
    assert.equal(payload.guestCount, 100);
    assert.deepEqual(payload.priorities, ['food']);
    assert.equal(payload.currency, 'INR');
    assert.equal(payload.notes, 'hi');
  });

  it('validates on the client', () => {
    const errors = validatePayload(toPayload({ eventDate: '2020-01-01', guestCount: '0', budget: '', priorities: ['a', 'b', 'c', 'd'] }), '2026-10-28');
    assert.deepEqual(Object.keys(errors).sort(), ['budget', 'eventDate', 'guestCount', 'priorities']);
    assert.deepEqual(validatePayload(toPayload({ eventDate: '2026-11-01', guestCount: '10', budget: '5000' }), '2026-10-28'), {});
  });
});
