import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig, toPositiveInt } from '../src/config.js';
import { LruCache } from '../src/lib/cache.js';
import { RateLimiter } from '../src/lib/rateLimiter.js';
import { clientIp } from '../src/lib/security.js';

describe('config', () => {
  it('parses env with safe defaults', () => {
    assert.equal(toPositiveInt('abc', 5), 5);
    assert.equal(toPositiveInt('-3', 5), 5);
    const config = loadConfig({ PORT: '9000', GEMINI_API_KEY: 'k' });
    assert.equal(config.port, 9000);
    assert.equal(config.gemini.apiKey, 'k');
    assert.equal(loadConfig({}).port, 8080);
    assert.ok(Object.isFrozen(config));
  });
});

describe('LruCache', () => {
  it('evicts least recently used entries', () => {
    const cache = new LruCache({ maxEntries: 2, ttlMs: 1000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    assert.equal(cache.get('b'), undefined);
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.size, 2);
  });

  it('expires entries after the TTL', () => {
    let t = 0;
    const cache = new LruCache({ maxEntries: 5, ttlMs: 100, now: () => t });
    cache.set('a', 1);
    t = 150;
    assert.equal(cache.get('a'), undefined);
  });
});

describe('RateLimiter', () => {
  it('allows the burst capacity, blocks, then refills', () => {
    let t = 0;
    const limiter = new RateLimiter({ capacity: 2, windowMs: 60_000, now: () => t });
    assert.equal(limiter.take('ip').allowed, true);
    assert.equal(limiter.take('ip').allowed, true);
    const blocked = limiter.take('ip');
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSec > 0);
    assert.equal(limiter.take('other').allowed, true);
    t = 30_000;
    assert.equal(limiter.take('ip').allowed, true);
  });

  it('bounds memory usage', () => {
    const limiter = new RateLimiter({ capacity: 1, windowMs: 1000, maxKeys: 3 });
    for (let i = 0; i < 10; i += 1) limiter.take(`ip-${i}`);
    assert.equal(limiter.buckets.size, 3);
  });
});

describe('clientIp', () => {
  it('prefers the first X-Forwarded-For hop, then the socket', () => {
    assert.equal(clientIp(/** @type {any} */ ({ headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }, socket: {} })), '1.2.3.4');
    assert.equal(clientIp(/** @type {any} */ ({ headers: {}, socket: { remoteAddress: '::1' } })), '::1');
  });
});
