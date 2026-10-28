/** Vercel serverless entry for GET /api/health (also reachable as /healthz). */
import { createHandler } from '../src/app.js';
import { buildDeps } from '../src/container.js';

export default createHandler(buildDeps().deps);
