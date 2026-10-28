/**
 * Vercel serverless entry for POST /api/plan. Static files are served by Vercel's CDN;
 * this function reuses the exact same handler as the standalone server.
 */
import { createHandler } from '../src/app.js';
import { buildDeps } from '../src/container.js';

// Built once per warm instance, so the cache and rate limiter persist between invocations.
export default createHandler(buildDeps().deps);
