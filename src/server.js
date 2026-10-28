/**
 * Standalone entry point (local development and Google Cloud Run): serves the UI
 * and API from one process and shuts down gracefully on SIGTERM.
 */
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { buildDeps } from './container.js';
import { loadAssets } from './lib/static.js';

const { config, gemini, deps } = buildDeps({
  assets: loadAssets(fileURLToPath(new URL('../public', import.meta.url))),
});
const server = createApp(deps);

server.headersTimeout = 30_000;
server.requestTimeout = 60_000;

server.listen(config.port, () => {
  console.info(
    JSON.stringify({
      severity: 'INFO',
      message: `Utsav planner listening on :${config.port}`,
      model: gemini.enabled ? config.gemini.model : 'fallback-only (GEMINI_API_KEY not set)',
    }),
  );
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
