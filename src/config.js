/**
 * Centralised, validated runtime configuration.
 * Every value comes from the environment so the same image runs locally and on Cloud Run.
 * @module config
 */

/**
 * Parse a positive integer from an env var, falling back to a default.
 * @param {string | undefined} raw
 * @param {number} fallback
 * @returns {number}
 */
export function toPositiveInt(raw, fallback) {
  const value = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Build the config object from an env map (injectable for tests).
 * @param {Record<string, string | undefined>} env
 */
export function loadConfig(env = process.env) {
  return Object.freeze({
    port: toPositiveInt(env.PORT, 8080),
    nodeEnv: env.NODE_ENV ?? 'development',
    gemini: Object.freeze({
      apiKey: env.GEMINI_API_KEY ?? '',
      model: env.GEMINI_MODEL || 'gemini-3.8-flash',
      // Faster backup used when the primary model is overloaded or slow.
      fallbackModel: env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite',
      // Low thinking keeps latency well inside serverless time limits; "off" disables it.
      thinkingLevel: env.GEMINI_THINKING_LEVEL === 'off' ? '' : env.GEMINI_THINKING_LEVEL || 'low',
      // Total budget for all Gemini attempts per plan.
      timeoutMs: toPositiveInt(env.GEMINI_TIMEOUT_MS, 22_000),
    }),
    rateLimit: Object.freeze({
      capacity: toPositiveInt(env.RATE_LIMIT_PER_MINUTE, 10),
      windowMs: 60_000,
    }),
    cache: Object.freeze({
      maxEntries: toPositiveInt(env.CACHE_MAX_ENTRIES, 200),
      ttlMs: toPositiveInt(env.CACHE_TTL_MS, 60 * 60 * 1000),
    }),
    maxBodyBytes: 8 * 1024,
  });
}
