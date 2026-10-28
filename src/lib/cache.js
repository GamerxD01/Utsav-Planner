/**
 * Small LRU cache with TTL. Identical plan requests are served without another
 * Gemini call, which cuts latency and API cost.
 * @module cache
 */

/** @template V */
export class LruCache {
  /**
   * @param {{ maxEntries: number, ttlMs: number, now?: () => number }} options
   */
  constructor({ maxEntries, ttlMs, now = Date.now }) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.now = now;
    /** @type {Map<string, { value: V, expires: number }>} */
    this.store = new Map();
  }

  /**
   * @param {string} key
   * @returns {V | undefined}
   */
  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  /**
   * @param {string} key
   * @param {V} value
   */
  set(key, value) {
    this.store.delete(key);
    this.store.set(key, { value, expires: this.now() + this.ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  get size() {
    return this.store.size;
  }
}
