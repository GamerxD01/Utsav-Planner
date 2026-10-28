/**
 * Browser UI. All dynamic content is rendered with textContent / DOM APIs
 * (never innerHTML), so AI or user text cannot inject markup.
 */
import { buildIcs, formatDate, formatMoney, progressKey, toPayload, validatePayload } from './format.js';

const $ = (/** @type {string} */ sel) => /** @type {HTMLElement} */ (document.querySelector(sel));

const form = /** @type {HTMLFormElement} */ ($('#plan-form'));
const submitBtn = /** @type {HTMLButtonElement} */ ($('#submit-btn'));
const statusEl = $('#status');
const results = $('#results');
const FIELD_LABELS = { eventType: 'Event type', eventDate: 'Event date', guestCount: 'Number of guests', budget: 'Total budget', currency: 'Currency', priorities: 'Top priorities' };

/** @type {any} */
let currentPlan = null;
let busy = false;

const todayIso = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
};

/**
 * Create an element with optional class and text.
 * @param {string} tag
 * @param {{ className?: string, text?: string, attrs?: Record<string, string> }} [opts]
 */
function el(tag, { className, text, attrs } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

const storage = {
  /** @param {string} key */
  read(key) {
    try { return JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { return {}; }
  },
  /** @param {string} key @param {object} value */
  write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: progress is session-only */ }
  },
};

/* ---------- Form behaviour ---------- */

/** @type {HTMLInputElement} */ ($('#eventDate')).min = todayIso();

const notes = /** @type {HTMLTextAreaElement} */ ($('#notes'));
notes.addEventListener('input', () => { $('#notes-count').textContent = String(notes.value.length); });

// Enforce "max 3 priorities" by disabling the remaining boxes, with an explanation.
const priorityBoxes = /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('input[name="priorities"]'));
const priorityHint = $('#priorities-hint');
for (const box of priorityBoxes) {
  box.addEventListener('change', () => {
    const count = [...priorityBoxes].filter((b) => b.checked).length;
    for (const b of priorityBoxes) b.disabled = !b.checked && count >= 3;
    priorityHint.textContent = count >= 3
      ? 'You have picked 3 priorities. Untick one to choose another.'
      : 'We give these a bigger share of the budget.';
  });
}

function clearErrors() {
  $('#error-summary').hidden = true;
  $('#error-list').replaceChildren();
  for (const node of form.querySelectorAll('[aria-invalid]')) node.removeAttribute('aria-invalid');
  for (const msg of form.querySelectorAll('.error-msg')) {
    msg.textContent = '';
    /** @type {HTMLElement} */ (msg).hidden = true;
  }
}

/**
 * Show an error summary (focused) plus inline messages linked to each field.
 * @param {Record<string, string>} errors
 */
function showErrors(errors) {
  clearErrors();
  const list = $('#error-list');
  for (const [field, message] of Object.entries(errors)) {
    const li = el('li');
    const link = el('a', { text: `${FIELD_LABELS[/** @type {keyof typeof FIELD_LABELS} */ (field)] ?? field}: ${message}`, attrs: { href: `#${field}` } });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const target = document.getElementById(field);
      const focusable = target?.matches('fieldset') ? target.querySelector('input') : target;
      /** @type {HTMLElement | null | undefined} */ (focusable)?.focus();
    });
    li.append(link);
    list.append(li);

    const input = document.getElementById(field);
    if (input && !input.matches('fieldset')) input.setAttribute('aria-invalid', 'true');
    const inline = document.getElementById(`${field}-error`);
    if (inline) {
      inline.textContent = message;
      inline.hidden = false;
    }
  }
  const summary = $('#error-summary');
  summary.hidden = false;
  summary.focus();
}

/** @param {boolean} on @param {string} message */
function setBusy(on, message) {
  busy = on;
  submitBtn.setAttribute('aria-disabled', String(on));
  submitBtn.textContent = on ? 'Generating…' : 'Generate my plan';
  form.setAttribute('aria-busy', String(on));
  statusEl.classList.toggle('busy', on);
  statusEl.textContent = message;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;

  const data = new FormData(form);
  /** @type {Record<string, string | string[]>} */
  const values = {};
  for (const key of new Set(data.keys())) {
    const all = data.getAll(key).map(String);
    values[key] = key === 'priorities' ? all : all[0];
  }
  const payload = toPayload(values);
  const errors = validatePayload(payload, todayIso());
  if (Object.keys(errors).length) {
    showErrors(errors);
    statusEl.textContent = '';
    return;
  }

  clearErrors();
  setBusy(true, 'Crafting your plan with Gemini… this usually takes a few seconds.');
  try {
    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (body.fields) showErrors(body.fields);
      setBusy(false, body.error ?? 'Something went wrong. Please try again.');
      return;
    }
    setBusy(false, 'Your plan is ready.');
    renderPlan(body);
  } catch {
    setBusy(false, 'Could not reach the server. Check your connection and try again.');
  }
});

/* ---------- Rendering ---------- */

/** @param {any} plan */
function renderPlan(plan) {
  currentPlan = plan;
  const { event, budget } = plan;
  const progress = storage.read(progressKey(plan));

  $('#results-title').textContent = event.name || `Your ${event.type} plan`;
  $('#plan-meta').textContent = [
    formatDate(event.date),
    `${event.daysUntil} day${event.daysUntil === 1 ? '' : 's'} to go`,
    `${event.guestCount} guests`,
    event.city,
  ].filter(Boolean).join(' · ');
  $('#plan-source').textContent = plan.source === 'gemini' ? '✨ Personalised by Gemini' : 'Curated suggestions (AI unavailable right now)';
  $('#plan-summary').textContent = plan.summary;

  renderBudget(budget);
  renderTimeline(plan.timeline, progress);
  renderVendors(plan.checklist, progress);
  renderList('#ideas', plan.ideas.map((/** @type {any} */ idea) => {
    const li = el('li');
    li.append(el('h3', { text: idea.title }), el('p', { text: idea.description }), el('span', { className: 'tag', text: idea.category.replace('-', ' ') }));
    return li;
  }));
  renderList('#budget-tips', plan.budgetTips.map((/** @type {string} */ t) => el('li', { text: t })));
  renderList('#risks', plan.risks.map((/** @type {string} */ t) => el('li', { text: t })));

  results.hidden = false;
  $('#results-title').focus();
}

/** @param {string} sel @param {HTMLElement[]} items */
function renderList(sel, items) {
  $(sel).replaceChildren(...items);
}

/** @param {any} budget */
function renderBudget(budget) {
  $('#budget-meta').textContent = `${formatMoney(budget.total, budget.currency)} total · about ${formatMoney(budget.perGuest, budget.currency)} per guest`;
  const rows = budget.lines.map((/** @type {any} */ line) => {
    const tr = el('tr');
    const th = el('th', { attrs: { scope: 'row' } });
    th.append(document.createTextNode(line.label));
    if (line.prioritized) th.append(el('span', { className: 'tag', text: 'Priority' }));
    const bar = el('span', { className: 'bar', attrs: { 'aria-hidden': 'true' } });
    const fill = el('span');
    fill.style.width = `${Math.min(100, line.percent * 2.5)}%`;
    bar.append(fill);
    th.append(bar);
    tr.append(th, el('td', { className: 'num', text: formatMoney(line.amount, budget.currency) }), el('td', { className: 'num', text: `${line.percent}%` }));
    return tr;
  });
  $('#budget-table tbody').replaceChildren(...rows);
  const total = el('tr');
  total.append(el('th', { text: 'Total', attrs: { scope: 'row' } }), el('td', { className: 'num', text: formatMoney(budget.total, budget.currency) }), el('td', { className: 'num', text: '100%' }));
  $('#budget-table tfoot').replaceChildren(total);
}

/**
 * Wire a checkbox to persisted progress.
 * @param {string} id @param {Record<string, boolean>} progress @param {() => void} onChange
 */
function progressCheckbox(id, progress, onChange) {
  const box = /** @type {HTMLInputElement} */ (el('input', { attrs: { type: 'checkbox', id } }));
  box.checked = Boolean(progress[id]);
  box.addEventListener('change', () => {
    progress[id] = box.checked;
    storage.write(progressKey(currentPlan), progress);
    onChange();
  });
  return box;
}

/**
 * @param {string} selector checkbox selector
 * @param {string} progressSel @param {string} labelSel @param {string} noun
 */
function updateProgress(selector, progressSel, labelSel, noun) {
  const boxes = /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll(selector));
  const done = [...boxes].filter((b) => b.checked).length;
  const bar = /** @type {HTMLProgressElement} */ ($(progressSel));
  bar.max = Math.max(boxes.length, 1);
  bar.value = done;
  $(labelSel).textContent = `${done} of ${boxes.length} ${noun}`;
}

/** @param {any[]} timeline @param {Record<string, boolean>} progress */
function renderTimeline(timeline, progress) {
  const refresh = () => updateProgress('#timeline input[type="checkbox"]', '#timeline-progress', '#timeline-progress-label', 'tasks done');
  const blocks = timeline.map((phase) => {
    const section = el('div', { className: 'phase' });
    const list = el('ul', { className: 'task-list' });
    for (const task of phase.tasks) {
      const id = `task-${task.id}`;
      const li = el('li');
      const label = el('label', { attrs: { for: id } });
      label.append(el('span', { className: 'task-text', text: task.text }));
      if (task.urgent) label.append(el('span', { className: 'tag tag-urgent', text: 'Urgent' }));
      if (task.source === 'ai') label.append(el('span', { className: 'tag', text: 'AI' }));
      const time = el('time', { className: 'task-date', text: `Due ${formatDate(task.dueDate)}`, attrs: { datetime: task.dueDate } });
      label.append(time);
      li.append(progressCheckbox(id, progress, refresh), label);
      list.append(li);
    }
    section.append(el('h3', { text: phase.phase }), list);
    return section;
  });
  $('#timeline').replaceChildren(...blocks);
  refresh();
}

/** @param {any[]} vendors @param {Record<string, boolean>} progress */
function renderVendors(vendors, progress) {
  const refresh = () => updateProgress('#vendors input[type="checkbox"]', '#vendor-progress', '#vendor-progress-label', 'vendors booked');
  const items = vendors.map((v) => {
    const li = el('li');
    const heading = el('h3', { text: v.vendor });
    if (v.urgent) heading.append(el('span', { className: 'tag tag-urgent', text: 'Book now' }));
    li.append(heading, el('p', { className: 'meta', text: `Book by ${formatDate(v.bookBy)}` }));
    if (v.tip) li.append(el('p', { className: 'vendor-tip', text: `💡 ${v.tip}` }));
    const details = el('details');
    const questions = el('ul', { className: 'bullets' });
    questions.append(...v.questions.map((/** @type {string} */ q) => el('li', { text: q })));
    details.append(el('summary', { text: 'Questions to ask' }), questions);
    const id = `vendor-${v.id}`;
    const booked = el('div', { className: 'vendor-booked' });
    booked.append(progressCheckbox(id, progress, refresh), el('label', { text: `${v.vendor} booked`, attrs: { for: id } }));
    li.append(details, booked);
    return li;
  });
  $('#vendors').replaceChildren(...items);
  refresh();
}

/* ---------- Actions ---------- */

$('#ics-btn').addEventListener('click', () => {
  if (!currentPlan) return;
  const blob = new Blob([buildIcs(currentPlan)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { attrs: { href: url, download: `utsav-${currentPlan.event.type}-${currentPlan.event.date}.ics` } });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  statusEl.textContent = 'Calendar file downloaded.';
});

$('#print-btn').addEventListener('click', () => window.print());

$('#edit-btn').addEventListener('click', () => {
  /** @type {HTMLElement} */ ($('#eventName')).focus();
  form.scrollIntoView();
});
