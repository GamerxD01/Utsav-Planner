/**
 * Token-bucket rate limiter keyed by client IP, protecting the Gemini quota from abuse.
 * @module rateLimiter
 */

export class RateLimiter {
  /**
   * @param {{ capacity: number, windowMs: number, now?: () => number, maxKeys?: number }} options
   */
  constructor({ capacity, windowMs, now = Date.now, maxKeys = 10_000 }) {
    this.capacity = capacity;
    this.refillPerMs = capacity / windowMs;
    this.now = now;
    this.maxKeys = maxKeys;
    /** @type {Map<string, { tokens: number, updated: number }>} */
    this.buckets = new Map();
  }

  /**
   * Try to consume one token.
   * @param {string} key
   * @returns {{ allowed: boolean, retryAfterSec: number, remaining: number }}
   */
  take(key) {
    const now = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updated: now };
    bucket.tokens = Math.min(this.capacity, bucket.tokens + (now - bucket.updated) * this.refillPerMs);
    bucket.updated = now;

    // Bound memory: drop the oldest key when the map is full.
    if (!this.buckets.has(key) && this.buckets.size >= this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
    this.buckets.set(key, bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterSec: 0, remaining: Math.floor(bucket.tokens) };
    }
    return {
      allowed: false,
      retryAfterSec: Math.ceil((1 - bucket.tokens) / this.refillPerMs / 1000),
      remaining: 0,
    };
  }
}
