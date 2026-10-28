/**
 * Entry point: wires configuration and dependencies, starts the server and
 * shuts down gracefully on SIGTERM (sent by Cloud Run before scaling in).
 */
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { LruCache } from './lib/cache.js';
import { createGeminiClient } from './lib/gemini.js';
import { createPlanner } from './lib/planner.js';
import { RateLimiter } from './lib/rateLimiter.js';
import { loadAssets } from './lib/static.js';

const config = loadConfig();
const gemini = createGeminiClient(config.gemini);
const planner = createPlanner({
  gemini,
  cache: new LruCache({ maxEntries: config.cache.maxEntries, ttlMs: config.cache.ttlMs }),
});
const server = createApp({
  config,
  planner,
  limiter: new RateLimiter(config.rateLimit),
  assets: loadAssets(fileURLToPath(new URL('../public', import.meta.url))),
  aiEnabled: gemini.enabled,
});

server.headersTimeout = 30_000;
server.requestTimeout = 60_000;

server.listen(config.port, () => {
  console.info(JSON.stringify({
    severity: 'INFO',
    message: `Utsav planner listening on :${config.port}`,
    model: gemini.enabled ? config.gemini.model : 'fallback-only (GEMINI_API_KEY not set)',
  }));
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
