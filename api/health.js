/**
 * Vercel serverless entry for GET /api/health (also reachable as /healthz).
 * Re-exports the shared handler so both routes run identical code.
 */
export { default } from './plan.js';
