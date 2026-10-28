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
 * Normalise a body that a hosting runtime already read.
 * @param {unknown} body
 * @param {number} maxBytes
 */
export function preParsedBody(body, maxBytes) {
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    if (Buffer.byteLength(body) > maxBytes) throw new HttpError(413, 'Request body too large');
    try {
      return JSON.parse(body.toString());
    } catch {
      throw new HttpError(400, 'Malformed JSON');
    }
  }
  if (Buffer.byteLength(JSON.stringify(body ?? null)) > maxBytes) throw new HttpError(413, 'Request body too large');
  return body;
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

  // Serverless runtimes (e.g. Vercel) may have already buffered and parsed the body.
  if ('body' in req) {
    return new Promise((resolve) => {
      let body;
      try {
        body = /** @type {any} */ (req).body; // may be a parsing getter that throws
      } catch {
        throw new HttpError(400, 'Malformed JSON');
      }
      resolve(preParsedBody(body, maxBytes));
    });
  }

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
export function createHandler({
  config,
  planner,
  limiter,
  assets,
  aiEnabled,
  now = () => new Date(),
  logger = console,
}) {
  /** @typedef {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void> | void} Route */

  /**
   * Reject methods a route does not support.
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string[]} allowed
   */
  function requireMethod(req, res, allowed) {
    if (allowed.includes(req.method ?? '')) return;
    res.setHeader('Allow', allowed.join(', '));
    throw new HttpError(405, 'Method not allowed');
  }

  /** POST /api/plan — validate, rate limit and generate a plan. @type {Route} */
  async function planRoute(req, res) {
    requireMethod(req, res, ['POST']);
    const limit = limiter.take(clientIp(req));
    res.setHeader('X-RateLimit-Remaining', String(limit.remaining));
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSec));
      throw new HttpError(429, 'Too many requests. Please wait a moment and try again.');
    }
    const result = validatePlanRequest(await readJsonBody(req, config.maxBodyBytes), now());
    if (!result.ok) throw new HttpError(422, 'Please fix the highlighted fields.', result.errors);

    const started = Date.now();
    const { plan, cached } = await planner.plan(result.value);
    logger.info(
      JSON.stringify({
        severity: 'INFO',
        message: 'plan generated',
        eventType: result.value.eventType,
        source: plan.source,
        cached,
        ms: Date.now() - started,
      }),
    );
    sendJson(res, 200, { ...plan, cached });
  }

  /** GET /healthz and /api/health — liveness plus whether Gemini is configured. @type {Route} */
  function healthRoute(_req, res) {
    sendJson(res, 200, { status: 'ok', ai: aiEnabled });
  }

  /** Everything else — static assets from the in-memory whitelist. @type {Route} */
  function staticRoute(req, res) {
    requireMethod(req, res, ['GET', 'HEAD']);
    const asset = assets.get(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (!asset) throw new HttpError(404, 'Not found');
    sendAsset(req, res, asset);
  }

  /** @type {Record<string, Route>} */
  const routes = { '/api/plan': planRoute, '/api/health': healthRoute, '/healthz': healthRoute };

  /**
   * Map any error to a safe JSON response (no internals leaked on 5xx).
   * @param {import('node:http').ServerResponse} res
   * @param {unknown} error
   */
  function sendError(res, error) {
    const known = error instanceof HttpError ? error : null;
    const status = known ? known.status : 500;
    if (status >= 500) {
      logger.error(
        JSON.stringify({
          severity: 'ERROR',
          message: 'unhandled error',
          error: String(error instanceof Error ? error.stack : error),
        }),
      );
    }
    if (res.headersSent) {
      res.end();
      return;
    }
    sendJson(res, status, {
      error: known && status < 500 ? known.message : 'Something went wrong. Please try again.',
      ...(known?.details ? { fields: known.details } : {}),
    });
  }

  /**
   * Request listener usable by node:http or a serverless runtime.
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  return async (req, res) => {
    applySecurityHeaders(res);
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    try {
      await (routes[pathname] ?? staticRoute)(req, res);
    } catch (error) {
      sendError(res, error);
    }
  };
}

/**
 * Create the standalone HTTP server (local development and Cloud Run).
 * @param {Parameters<typeof createHandler>[0]} deps
 */
export function createApp(deps) {
  return createServer(createHandler(deps));
}
