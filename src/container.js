/**
 * Composition root: builds the application's dependencies once per process.
 * Shared by the standalone server (Cloud Run / local) and serverless functions (Vercel).
 * @module container
 */
import { loadConfig } from './config.js';
import { LruCache } from './lib/cache.js';
import { createGeminiClient } from './lib/gemini.js';
import { createPlanner } from './lib/planner.js';
import { RateLimiter } from './lib/rateLimiter.js';

/**
 * @param {{ env?: Record<string, string | undefined>, assets?: Map<string, import('./lib/static.js').Asset> }} [options]
 */
export function buildDeps({ env = process.env, assets = new Map() } = {}) {
  const config = loadConfig(env);
  const gemini = createGeminiClient(config.gemini);
  return {
    config,
    gemini,
    deps: {
      config,
      planner: createPlanner({
        gemini,
        cache: new LruCache({ maxEntries: config.cache.maxEntries, ttlMs: config.cache.ttlMs }),
      }),
      limiter: new RateLimiter(config.rateLimit),
      assets,
      aiEnabled: gemini.enabled,
    },
  };
}
