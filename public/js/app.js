/**
 * Entry point: wires the form, the API call and the plan actions together.
 * @module app
 */
import { $, el } from './dom.js';
import { clearErrors, enhanceForm, readForm, setBusy, showErrors } from './form.js';
import { buildIcs, todayIso, validatePayload } from './format.js';
import { renderPlan } from './render.js';

/** @typedef {import('./types.js').Plan} Plan */

const MESSAGES = Object.freeze({
  working: 'Crafting your personalised plan with Gemini… this can take up to 20 seconds.',
  ready: 'Your plan is ready.',
  failed: 'Something went wrong. Please try again.',
  offline: 'Could not reach the server. Check your connection and try again.',
  calendar: 'Calendar file downloaded.',
});

const form = /** @type {HTMLFormElement} */ ($('#plan-form'));
/** @type {Plan | null} */
let currentPlan = null;
let busy = false;

/**
 * POST the payload and return the plan, or the server's error body.
 * @param {ReturnType<typeof readForm>} payload
 * @returns {Promise<{ ok: true, plan: Plan } | { ok: false, error: string, fields?: Record<string, string> }>}
 */
async function requestPlan(payload) {
  const res = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, plan: body } : { ok: false, error: body.error ?? MESSAGES.failed, fields: body.fields };
}

/** @param {SubmitEvent} event */
async function onSubmit(event) {
  event.preventDefault();
  if (busy) return;

  const payload = readForm(form);
  const errors = validatePayload(payload, todayIso());
  if (Object.keys(errors).length > 0) {
    showErrors(form, errors);
    $('#status').textContent = '';
    return;
  }

  clearErrors(form);
  busy = true;
  setBusy(form, true, MESSAGES.working);
  try {
    const result = await requestPlan(payload);
    if (result.ok) {
      setBusy(form, false, MESSAGES.ready);
      currentPlan = result.plan;
      renderPlan(result.plan);
    } else {
      if (result.fields) showErrors(form, result.fields);
      setBusy(form, false, result.error);
    }
  } catch {
    setBusy(form, false, MESSAGES.offline);
  } finally {
    busy = false;
  }
}

/** Download the plan's timeline as an .ics calendar file. */
function downloadCalendar() {
  if (!currentPlan) return;
  const url = URL.createObjectURL(new Blob([buildIcs(currentPlan)], { type: 'text/calendar;charset=utf-8' }));
  const link = el('a', {
    attrs: { href: url, download: `utsav-${currentPlan.event.type}-${currentPlan.event.date}.ics` },
  });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('#status').textContent = MESSAGES.calendar;
}

enhanceForm(todayIso());
form.addEventListener('submit', onSubmit);
$('#ics-btn').addEventListener('click', downloadCalendar);
$('#print-btn').addEventListener('click', () => window.print());
$('#edit-btn').addEventListener('click', () => {
  $('#eventName').focus();
  form.scrollIntoView();
});
