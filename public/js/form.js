/**
 * Form behaviour: reading values, accessible error reporting, busy state and
 * the "max 3 priorities" rule.
 * @module form
 */
import { $, el } from './dom.js';
import { MAX_PRIORITIES, toPayload } from './format.js';

/** Labels used in the error summary, keyed by field id. */
const FIELD_LABELS = Object.freeze({
  eventType: 'Event type',
  eventDate: 'Event date',
  guestCount: 'Number of guests',
  budget: 'Total budget',
  currency: 'Currency',
  priorities: 'Top priorities',
});

const PRIORITY_HINT = 'We give these a bigger share of the budget.';
const PRIORITY_LIMIT_HINT = `You have picked ${MAX_PRIORITIES} priorities. Untick one to choose another.`;

/**
 * Read the form into the API payload shape.
 * @param {HTMLFormElement} form
 */
export function readForm(form) {
  const data = new FormData(form);
  /** @type {Record<string, string | string[]>} */
  const values = {};
  for (const key of new Set(data.keys())) {
    const all = data.getAll(key).map(String);
    values[key] = key === 'priorities' ? all : all[0];
  }
  return toPayload(values);
}

/** @param {HTMLFormElement} form */
export function clearErrors(form) {
  $('#error-summary').hidden = true;
  $('#error-list').replaceChildren();
  for (const node of form.querySelectorAll('[aria-invalid]')) node.removeAttribute('aria-invalid');
  for (const msg of /** @type {NodeListOf<HTMLElement>} */ (form.querySelectorAll('.error-msg'))) {
    msg.textContent = '';
    msg.hidden = true;
  }
}

/**
 * Focus the field behind an error link (the first input for radio/checkbox groups).
 * @param {string} field
 */
function focusField(field) {
  const target = document.getElementById(field);
  const focusable = target?.matches('fieldset') ? target.querySelector('input') : target;
  focusable?.focus();
}

/**
 * Show a focused error summary linking to each field, plus inline messages.
 * @param {HTMLFormElement} form
 * @param {Record<string, string>} errors field id → message
 */
export function showErrors(form, errors) {
  clearErrors(form);
  const list = $('#error-list');
  for (const [field, message] of Object.entries(errors)) {
    const label = FIELD_LABELS[/** @type {keyof typeof FIELD_LABELS} */ (field)] ?? field;
    const link = el('a', { text: `${label}: ${message}`, attrs: { href: `#${field}` } });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      focusField(field);
    });
    const item = el('li');
    item.append(link);
    list.append(item);

    const input = document.getElementById(field);
    // aria-invalid is not valid on a fieldset (role="group"); groups rely on the inline message.
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

/**
 * Toggle the submitting state and announce it via the status live region.
 * @param {HTMLFormElement} form
 * @param {boolean} on
 * @param {string} message
 */
export function setBusy(form, on, message) {
  const button = $('#submit-btn');
  button.setAttribute('aria-disabled', String(on));
  button.textContent = on ? 'Generating…' : 'Generate my plan';
  form.setAttribute('aria-busy', String(on));
  const status = $('#status');
  status.classList.toggle('busy', on);
  status.textContent = message;
}

/**
 * Wire field-level behaviour: date minimum, notes counter and the priorities limit.
 * @param {string} today ISO date
 */
export function enhanceForm(today) {
  $('#eventDate').setAttribute('min', today);

  const notes = /** @type {HTMLTextAreaElement} */ ($('#notes'));
  notes.addEventListener('input', () => {
    $('#notes-count').textContent = String(notes.value.length);
  });

  const boxes = /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('input[name="priorities"]'));
  const hint = $('#priorities-hint');
  for (const box of boxes) {
    box.addEventListener('change', () => {
      const atLimit = [...boxes].filter((b) => b.checked).length >= MAX_PRIORITIES;
      for (const b of boxes) b.disabled = !b.checked && atLimit;
      hint.textContent = atLimit ? PRIORITY_LIMIT_HINT : PRIORITY_HINT;
    });
  }
}
