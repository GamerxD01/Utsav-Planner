/**
 * Small DOM and storage helpers. Elements are built with textContent and
 * setAttribute only (never innerHTML), so AI or user text cannot inject markup.
 * @module dom
 */

/**
 * querySelector that asserts the element exists (all selectors are static IDs in index.html).
 * @template {HTMLElement} [T=HTMLElement]
 * @param {string} selector
 * @returns {T}
 */
export function $(selector) {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return /** @type {T} */ (node);
}

/**
 * Create an element with optional class, text and attributes.
 * @param {string} tag
 * @param {{ className?: string, text?: string, attrs?: Record<string, string> }} [options]
 * @returns {HTMLElement}
 */
export function el(tag, { className, text, attrs } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (attrs) for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

/**
 * localStorage wrapper that never throws (private mode, blocked storage, quota).
 * Progress is a per-browser convenience, so failures silently degrade to session-only.
 */
export const storage = {
  /**
   * @param {string} key
   * @returns {Record<string, boolean>}
   */
  read(key) {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '{}');
    } catch {
      return {};
    }
  },
  /**
   * @param {string} key
   * @param {object} value
   */
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage unavailable: progress lasts for this session only.
    }
  },
};
