import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allocate, buildBudget, computeWeights } from '../src/lib/budget.js';
import { buildChecklist } from '../src/lib/checklist.js';
import { BUDGET_WEIGHTS, EVENT_TYPES } from '../src/lib/constants.js';
import { addDays, buildTimeline, phaseFor } from '../src/lib/timeline.js';

const sum = (/** @type {number[]} */ xs) => xs.reduce((a, b) => a + b, 0);

describe('budget engine', () => {
  it('baseline weights sum to 1 for every event type', () => {
    for (const type of EVENT_TYPES) {
      assert.ok(Math.abs(sum(Object.values(BUDGET_WEIGHTS[type])) - 1) < 1e-9, type);
    }
  });

  it('boosts priorities but keeps contingency fixed and total at 1', () => {
    const base = computeWeights('wedding', []);
    const boosted = computeWeights('wedding', ['photography']);
    assert.ok(boosted.photography > base.photography);
    assert.equal(boosted.contingency, base.contingency);
    assert.ok(Math.abs(sum(Object.values(boosted)) - 1) < 1e-9);
  });

  it('adds a category when a priority is not in the baseline', () => {
    const weights = computeWeights('birthday', ['attire']);
    assert.ok(weights.attire > 0);
  });

  it('throws for an unknown event type', () => {
    assert.throws(() => computeWeights(/** @type {any} */ ('gala')), /Unknown event type/);
  });

  it('allocate() always sums exactly to the total', () => {
    for (const total of [100, 999, 12_345, 1_500_000, 7]) {
      const parts = allocate(total, computeWeights('community', ['food']));
      assert.equal(sum(Object.values(parts)), total);
    }
  });

  it('buildBudget returns sorted lines with contingency last and per-guest cost', () => {
    const budget = buildBudget({ eventType: 'wedding', budget: 1_000_000, guestCount: 200, currency: 'INR', priorities: ['food'] });
    assert.equal(budget.perGuest, 5000);
    assert.equal(sum(budget.lines.map((l) => l.amount)), 1_000_000);
    assert.equal(budget.lines.at(-1)?.category, 'contingency');
    assert.equal(budget.lines[0].category, 'food');
    assert.equal(budget.lines[0].prioritized, true);
  });
});

describe('timeline engine', () => {
  it('maps days to phases', () => {
    assert.equal(phaseFor(400), '6+ months before');
    assert.equal(phaseFor(100), '3–6 months before');
    assert.equal(phaseFor(3), 'Event week');
    assert.equal(phaseFor(0), 'Event day');
    assert.equal(phaseFor(-5), 'After the event');
  });

  it('addDays handles month boundaries', () => {
    assert.equal(addDays('2027-03-01', -1), '2027-02-28');
    assert.equal(addDays('2027-12-31', 1), '2028-01-01');
  });

  it('uses ideal dates when there is enough lead time', () => {
    const timeline = buildTimeline({ eventType: 'birthday', eventDate: '2027-01-31', leadDays: 120 });
    const tasks = timeline.flatMap((p) => p.tasks);
    assert.ok(tasks.every((t) => !t.urgent));
    assert.equal(tasks.find((t) => t.id === 'b-cake')?.dueDate, '2027-01-17');
  });

  it('compresses and flags urgent tasks when the event is soon, never scheduling in the past', () => {
    const timeline = buildTimeline({ eventType: 'wedding', eventDate: '2026-12-27', leadDays: 60 });
    const tasks = timeline.flatMap((p) => p.tasks);
    assert.ok(tasks.find((t) => t.id === 'w-venue')?.urgent);
    const earliest = tasks.map((t) => t.dueDate).sort()[0];
    assert.ok(earliest >= '2026-10-28', earliest);
  });

  it('keeps tasks in chronological order and merges AI tasks', () => {
    const timeline = buildTimeline({ eventType: 'community', eventDate: '2027-06-01', leadDays: 200 }, [{ task: 'Book drone permit', weeksBefore: 6 }]);
    const dates = timeline.flatMap((p) => p.tasks.map((t) => t.dueDate));
    assert.deepEqual(dates, [...dates].sort());
    const ai = timeline.flatMap((p) => p.tasks).find((t) => t.source === 'ai');
    assert.equal(ai?.text, 'Book drone permit');
    assert.equal(timeline.at(-1)?.phase, 'After the event');
  });
});

describe('vendor checklist', () => {
  it('sorts by booking date and attaches matching AI tips', () => {
    const list = buildChecklist({ eventType: 'wedding', eventDate: '2027-10-28', leadDays: 365 }, [{ vendor: 'Caterer', tip: 'Ask for a tasting.' }]);
    assert.deepEqual(list.map((v) => v.bookBy), [...list.map((v) => v.bookBy)].sort());
    assert.equal(list.find((v) => v.id === 'caterer')?.tip, 'Ask for a tasting.');
    assert.ok(list.every((v) => v.questions.length >= 3));
  });

  it('marks vendors urgent and books no later than the day before when time is short', () => {
    const list = buildChecklist({ eventType: 'birthday', eventDate: '2026-11-04', leadDays: 7 });
    const venue = list.find((v) => v.id === 'venue');
    assert.equal(venue?.urgent, true);
    assert.equal(venue?.bookBy, '2026-10-29');
  });
});
