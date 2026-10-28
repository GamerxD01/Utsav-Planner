import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { HttpError, createHandler, preParsedBody } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { buildDeps } from '../src/container.js';
import { LruCache } from '../src/lib/cache.js';
import { createPlanner } from '../src/lib/planner.js';
import { RateLimiter } from '../src/lib/rateLimiter.js';
import { SECURITY_HEADERS } from '../src/lib/security.js';
import { NOW, fakeGemini, silentLogger, validBody } from './helpers.js';

/** Minimal ServerResponse stand-in capturing what the handler writes. */
function fakeRes() {
  const headers = {};
  let resolveDone;
  const done = new Promise((r) => {
    resolveDone = r;
  });
  return {
    headers,
    done,
    status: 0,
    body: '',
    headersSent: false,
    setHeader(k, v) {
      headers[k.toLowerCase()] = v;
    },
    writeHead(s) {
      this.status = s;
      this.headersSent = true;
      return this;
    },
    end(b) {
      this.body = b ?? '';
      resolveDone();
    },
  };
}

/** Request whose body was already parsed by the platform (as on Vercel). */
const fakeReq = (body, { getterThrows = false } = {}) => {
  const req = {
    method: 'POST',
    url: '/api/plan',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.1' },
    socket: {},
  };
  Object.defineProperty(req, 'body', {
    enumerable: true,
    get() {
      if (getterThrows) throw new Error('Invalid JSON');
      return body;
    },
  });
  return req;
};

const handler = () =>
  createHandler({
    config: loadConfig({}),
    planner: createPlanner({
      gemini: fakeGemini(),
      cache: new LruCache({ maxEntries: 5, ttlMs: 1000 }),
      logger: silentLogger,
    }),
    limiter: new RateLimiter({ capacity: 5, windowMs: 60_000 }),
    assets: new Map(),
    aiEnabled: true,
    now: () => NOW,
    logger: silentLogger,
  });

describe('serverless (Vercel) support', () => {
  it('handles a body the platform already parsed', async () => {
    const res = fakeRes();
    handler()(fakeReq(validBody()), res);
    await res.done;
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).source, 'gemini');
    assert.match(res.headers['content-security-policy'], /default-src 'self'/);
  });

  it('maps a throwing body parser to 400', async () => {
    const res = fakeRes();
    handler()(fakeReq(undefined, { getterThrows: true }), res);
    await res.done;
    assert.equal(res.status, 400);
  });

  it('preParsedBody parses strings/buffers and enforces the size cap', () => {
    assert.deepEqual(preParsedBody('{"a":1}', 100), { a: 1 });
    assert.deepEqual(preParsedBody(Buffer.from('{"a":2}'), 100), { a: 2 });
    assert.deepEqual(preParsedBody({ a: 3 }, 100), { a: 3 });
    assert.throws(
      () => preParsedBody('{bad', 100),
      (e) => e instanceof HttpError && e.status === 400,
    );
    assert.throws(
      () => preParsedBody({ x: 'y'.repeat(200) }, 100),
      (e) => e instanceof HttpError && e.status === 413,
    );
  });

  it('buildDeps wires fallback mode without an API key', () => {
    const { deps } = buildDeps({ env: {} });
    assert.equal(deps.aiEnabled, false);
    assert.equal(deps.assets.size, 0);
  });

  it('vercel.json sends the same security headers as the Node server', () => {
    const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    const sent = Object.fromEntries(vercel.headers[0].headers.map((h) => [h.key, h.value]));
    assert.deepEqual(sent, { ...SECURITY_HEADERS });
  });
});
