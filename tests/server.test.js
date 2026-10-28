import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { LruCache } from '../src/lib/cache.js';
import { createPlanner } from '../src/lib/planner.js';
import { RateLimiter } from '../src/lib/rateLimiter.js';
import { loadAssets } from '../src/lib/static.js';
import { NOW, fakeGemini, silentLogger, validBody } from './helpers.js';

/** @type {import('node:http').Server} */
let server;
let base = '';

before(async () => {
  const config = loadConfig({});
  server = createApp({
    config,
    planner: createPlanner({ gemini: fakeGemini(), cache: new LruCache({ maxEntries: 10, ttlMs: 60_000 }), logger: silentLogger }),
    limiter: new RateLimiter({ capacity: 5, windowMs: 60_000 }),
    assets: loadAssets(fileURLToPath(new URL('../public', import.meta.url))),
    aiEnabled: true,
    now: () => NOW,
    logger: silentLogger,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  base = `http://127.0.0.1:${address.port}`;
});

after(() => new Promise((resolve) => server.close(() => resolve(undefined))));

/** @param {unknown} body @param {Record<string, string>} [headers] */
const postPlan = (body, headers = {}) => fetch(`${base}/api/plan`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.1', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

describe('HTTP server', () => {
  it('serves the app shell with security headers and compression', async () => {
    const res = await fetch(`${base}/`, { headers: { 'Accept-Encoding': 'br' } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('content-encoding'), 'br');
    assert.match(await res.text(), /<html lang="en">/);
  });

  it('returns 304 for a matching ETag', async () => {
    const first = await fetch(`${base}/styles.css`);
    const etag = first.headers.get('etag') ?? '';
    const second = await fetch(`${base}/styles.css`, { headers: { 'If-None-Match': etag } });
    assert.equal(second.status, 304);
  });

  it('blocks path traversal and unknown files', async () => {
    for (const path of ['/../package.json', '/%2e%2e/src/server.js', '/nope.js']) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 404, path);
    }
  });

  it('reports health', async () => {
    const res = await fetch(`${base}/healthz`);
    assert.deepEqual(await res.json(), { status: 'ok', ai: true });
  });

  it('generates a plan', async () => {
    const res = await postPlan(validBody());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const plan = await res.json();
    assert.equal(plan.source, 'gemini');
    assert.equal(plan.budget.total, 1_500_000);
    assert.ok(plan.timeline.length > 3);
    assert.ok(plan.checklist.length > 3);
  });

  it('returns field errors with 422', async () => {
    const res = await postPlan(validBody({ guestCount: -1 }), { 'X-Forwarded-For': '203.0.113.2' });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.ok(body.fields.guestCount);
  });

  it('rejects wrong content type, malformed JSON, oversized bodies and wrong methods', async () => {
    const ip = { 'X-Forwarded-For': '203.0.113.3' };
    assert.equal((await fetch(`${base}/api/plan`, { method: 'POST', headers: { ...ip, 'Content-Type': 'text/plain' }, body: 'x' })).status, 415);
    assert.equal((await postPlan('{bad', ip)).status, 400);
    assert.equal((await postPlan({ notes: 'x'.repeat(20_000) }, ip)).status, 413);
    const get = await fetch(`${base}/api/plan`);
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST');
    assert.equal((await fetch(`${base}/`, { method: 'DELETE' })).status, 405);
  });

  it('rate limits per client IP', async () => {
    const statuses = [];
    for (let i = 0; i < 7; i += 1) {
      statuses.push((await postPlan(validBody(), { 'X-Forwarded-For': '198.51.100.9' })).status);
    }
    assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
    assert.equal(statuses.at(-1), 429);
  });
});
