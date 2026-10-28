/**
 * Renders a plan into the results section.
 * @module render
 */
import { $, el, storage } from './dom.js';
import { formatDate, formatMoney, progressKey } from './format.js';

/** @typedef {import('./types.js').Plan} Plan */
/** @typedef {import('./types.js').Progress} Progress */

/** Visual bar width multiplier: a 40% share fills the whole bar. */
const BAR_SCALE = 2.5;

/**
 * Render the full plan, restore saved progress and move focus to the results.
 * @param {Plan} plan
 */
export function renderPlan(plan) {
  const key = progressKey(plan);
  const progress = storage.read(key);
  const save = () => storage.write(key, progress);

  renderHeader(plan);
  renderBudget(plan.budget);
  renderTimeline(plan.timeline, progress, save);
  renderVendors(plan.checklist, progress, save);
  renderIdeas(plan.ideas);
  $('#budget-tips').replaceChildren(...plan.budgetTips.map((tip) => el('li', { text: tip })));
  $('#risks').replaceChildren(...plan.risks.map((risk) => el('li', { text: risk })));

  $('#results').hidden = false;
  $('#results-title').focus();
}

/** @param {Plan} plan */
function renderHeader({ event, source, summary }) {
  $('#results-title').textContent = event.name || `Your ${event.type} plan`;
  $('#plan-meta').textContent = [
    formatDate(event.date),
    `${event.daysUntil} day${event.daysUntil === 1 ? '' : 's'} to go`,
    `${event.guestCount} guests`,
    event.city,
  ]
    .filter(Boolean)
    .join(' · ');
  $('#plan-source').textContent =
    source === 'gemini' ? '✨ Personalised by Gemini' : 'Curated suggestions (AI unavailable right now)';
  $('#plan-summary').textContent = summary;
}

/** @param {Plan['budget']} budget */
function renderBudget(budget) {
  const money = (/** @type {number} */ amount) => formatMoney(amount, budget.currency);
  $('#budget-meta').textContent = `${money(budget.total)} total · about ${money(budget.perGuest)} per guest`;

  const rows = budget.lines.map((line) => {
    const th = el('th', { attrs: { scope: 'row' } });
    th.append(document.createTextNode(line.label));
    if (line.prioritized) th.append(el('span', { className: 'tag', text: 'Priority' }));
    const bar = el('span', { className: 'bar', attrs: { 'aria-hidden': 'true' } });
    const fill = el('span');
    fill.style.width = `${Math.min(100, line.percent * BAR_SCALE)}%`;
    bar.append(fill);
    th.append(bar);

    const tr = el('tr');
    tr.append(
      th,
      el('td', { className: 'num', text: money(line.amount) }),
      el('td', { className: 'num', text: `${line.percent}%` }),
    );
    return tr;
  });
  $('#budget-table tbody').replaceChildren(...rows);

  const total = el('tr');
  total.append(
    el('th', { text: 'Total', attrs: { scope: 'row' } }),
    el('td', { className: 'num', text: money(budget.total) }),
    el('td', { className: 'num', text: '100%' }),
  );
  $('#budget-table tfoot').replaceChildren(total);
}

/**
 * A checkbox whose state is stored in `progress`.
 * @param {string} id
 * @param {Progress} progress
 * @param {() => void} onChange
 */
function progressCheckbox(id, progress, onChange) {
  const box = /** @type {HTMLInputElement} */ (el('input', { attrs: { type: 'checkbox', id } }));
  box.checked = Boolean(progress[id]);
  box.addEventListener('change', () => {
    progress[id] = box.checked;
    onChange();
  });
  return box;
}

/**
 * Update a "x of y done" label and its <progress> bar from the checkboxes in a list.
 * @param {string} listId element holding the checkboxes
 * @param {string} progressId <progress> element; its label is `${progressId}-label`
 * @param {string} noun
 */
function updateProgress(listId, progressId, noun) {
  const boxes = /** @type {NodeListOf<HTMLInputElement>} */ (
    document.querySelectorAll(`#${listId} input[type="checkbox"]`)
  );
  const done = [...boxes].filter((box) => box.checked).length;
  const bar = $(`#${progressId}`);
  /** @type {HTMLProgressElement} */ (bar).max = Math.max(boxes.length, 1);
  /** @type {HTMLProgressElement} */ (bar).value = done;
  $(`#${progressId}-label`).textContent = `${done} of ${boxes.length} ${noun}`;
}

/**
 * @param {Plan['timeline']} timeline
 * @param {Progress} progress
 * @param {() => void} save
 */
function renderTimeline(timeline, progress, save) {
  const refresh = () => {
    save();
    updateProgress('timeline', 'timeline-progress', 'tasks done');
  };
  const blocks = timeline.map((phase) => {
    const list = el('ul', { className: 'task-list' });
    for (const task of phase.tasks) {
      const id = `task-${task.id}`;
      const label = el('label', { attrs: { for: id } });
      label.append(el('span', { className: 'task-text', text: task.text }));
      if (task.urgent) label.append(el('span', { className: 'tag tag-urgent', text: 'Urgent' }));
      if (task.source === 'ai') label.append(el('span', { className: 'tag', text: 'AI' }));
      label.append(
        el('time', {
          className: 'task-date',
          text: `Due ${formatDate(task.dueDate)}`,
          attrs: { datetime: task.dueDate },
        }),
      );

      const li = el('li');
      li.append(progressCheckbox(id, progress, refresh), label);
      list.append(li);
    }
    const section = el('div', { className: 'phase' });
    section.append(el('h3', { text: phase.phase }), list);
    return section;
  });
  $('#timeline').replaceChildren(...blocks);
  updateProgress('timeline', 'timeline-progress', 'tasks done');
}

/**
 * @param {Plan['checklist']} vendors
 * @param {Progress} progress
 * @param {() => void} save
 */
function renderVendors(vendors, progress, save) {
  const refresh = () => {
    save();
    updateProgress('vendors', 'vendor-progress', 'vendors booked');
  };
  const items = vendors.map((vendor) => {
    const heading = el('h3', { text: vendor.vendor });
    if (vendor.urgent) heading.append(el('span', { className: 'tag tag-urgent', text: 'Book now' }));

    const questions = el('ul', { className: 'bullets' });
    questions.append(...vendor.questions.map((question) => el('li', { text: question })));
    const details = el('details');
    details.append(el('summary', { text: 'Questions to ask' }), questions);

    const id = `vendor-${vendor.id}`;
    const booked = el('div', { className: 'vendor-booked' });
    booked.append(
      progressCheckbox(id, progress, refresh),
      el('label', { text: `${vendor.vendor} booked`, attrs: { for: id } }),
    );

    const li = el('li');
    li.append(heading, el('p', { className: 'meta', text: `Book by ${formatDate(vendor.bookBy)}` }));
    if (vendor.tip) li.append(el('p', { className: 'vendor-tip', text: `💡 ${vendor.tip}` }));
    li.append(details, booked);
    return li;
  });
  $('#vendors').replaceChildren(...items);
  updateProgress('vendors', 'vendor-progress', 'vendors booked');
}

/** @param {Plan['ideas']} ideas */
function renderIdeas(ideas) {
  const items = ideas.map((idea) => {
    const li = el('li');
    li.append(
      el('h3', { text: idea.title }),
      el('p', { text: idea.description }),
      el('span', { className: 'tag', text: idea.category.replace('-', ' ') }),
    );
    return li;
  });
  $('#ideas').replaceChildren(...items);
}
