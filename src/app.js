/**
 * HTTP application: routing, body parsing, rate limiting and error handling.
 * Built on node:http with zero runtime dependencies (no third-party supply-chain risk).
 * @module app
 */
import { createServer } from 'node:http';
import { applySecurityHeaders, clientIp } from './lib/security.js';
import { sendAsset } from './lib/static.js';
import { validatePlanRequest } from './lib/validation.js';

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   * @param {Record<string, string>} [details]
   */
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.writeHead(status).end(body);
}

/**
 * Read a JSON body with a hard size cap.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} maxBytes
 * @returns {Promise<unknown>}
 */
export function readJsonBody(req, maxBytes) {
  const type = String(req.headers['content-type'] ?? '');
  if (!type.toLowerCase().startsWith('application/json')) {
    return Promise.reject(new HttpError(415, 'Content-Type must be application/json'));
  }
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > maxBytes) return Promise.reject(new HttpError(413, 'Request body too large'));

  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    req.on('data', (/** @type {Buffer} */ chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Malformed JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * @param {{
 *   config: ReturnType<typeof import('./config.js').loadConfig>,
 *   planner: ReturnType<typeof import('./lib/planner.js').createPlanner>,
 *   limiter: import('./lib/rateLimiter.js').RateLimiter,
 *   assets: Map<string, import('./lib/static.js').Asset>,
 *   aiEnabled: boolean,
 *   now?: () => Date,
 *   logger?: Pick<Console, 'info' | 'error'>,
 * }} deps
 */
export function createApp({ config, planner, limiter, assets, aiEnabled, now = () => new Date(), logger = console }) {
  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handle(req, res) {
    applySecurityHeaders(res);
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');

    if (pathname === '/api/plan') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        throw new HttpError(405, 'Method not allowed');
      }
      const limit = limiter.take(clientIp(req));
      res.setHeader('X-RateLimit-Remaining', String(limit.remaining));
      if (!limit.allowed) {
        res.setHeader('Retry-After', String(limit.retryAfterSec));
        throw new HttpError(429, 'Too many requests. Please wait a moment and try again.');
      }
      const body = await readJsonBody(req, config.maxBodyBytes);
      const result = validatePlanRequest(body, now());
      if (!result.ok) throw new HttpError(422, 'Please fix the highlighted fields.', result.errors);

      const started = Date.now();
      const { plan, cached } = await planner.plan(result.value);
      logger.info(JSON.stringify({ severity: 'INFO', message: 'plan generated', eventType: result.value.eventType, source: plan.source, cached, ms: Date.now() - started }));
      sendJson(res, 200, { ...plan, cached });
      return;
    }

    if (pathname === '/healthz' || pathname === '/api/health') {
      sendJson(res, 200, { status: 'ok', ai: aiEnabled });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      throw new HttpError(405, 'Method not allowed');
    }
    const asset = assets.get(pathname);
    if (!asset) throw new HttpError(404, 'Not found');
    sendAsset(req, res, asset);
  }

  return createServer((req, res) => {
    handle(req, res).catch((error) => {
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) logger.error(JSON.stringify({ severity: 'ERROR', message: 'unhandled error', error: String(error?.stack ?? error) }));
      if (res.headersSent) {
        res.end();
        return;
      }
      sendJson(res, status, {
        error: status >= 500 ? 'Something went wrong. Please try again.' : error.message,
        ...(error instanceof HttpError && error.details ? { fields: error.details } : {}),
      });
    });
  });
}
