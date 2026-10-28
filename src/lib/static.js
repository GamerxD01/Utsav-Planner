/**
 * In-memory static asset server. Files are read and pre-compressed (Brotli + gzip)
 * once at startup; requests are matched against this whitelist only, so path
 * traversal is impossible by construction.
 * @module static
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep, extname } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
});

/**
 * @typedef {{ type: string, etag: string, raw: Buffer, br: Buffer, gzip: Buffer, cacheControl: string }} Asset
 */

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/**
 * Load every file under `root` into memory.
 * @param {string} root
 * @returns {Map<string, Asset>} keyed by URL path
 */
export function loadAssets(root) {
  /** @type {Map<string, Asset>} */
  const assets = new Map();
  for (const file of walk(root)) {
    const type = MIME[/** @type {keyof typeof MIME} */ (extname(file))];
    if (!type) continue;
    const raw = readFileSync(file);
    const urlPath = `/${relative(root, file).split(sep).join('/')}`;
    assets.set(urlPath, {
      type,
      raw,
      br: brotliCompressSync(raw),
      gzip: gzipSync(raw, { level: 9 }),
      etag: `"${createHash('sha1').update(raw).digest('base64url')}"`,
      // HTML must revalidate; other assets can be cached briefly and revalidated via ETag.
      cacheControl: type.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600, must-revalidate',
    });
  }
  if (assets.has('/index.html')) assets.set('/', /** @type {Asset} */ (assets.get('/index.html')));
  return assets;
}

/**
 * Serve an asset, honouring conditional requests and Accept-Encoding.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {Asset} asset
 */
export function sendAsset(req, res, asset) {
  res.setHeader('Content-Type', asset.type);
  res.setHeader('ETag', asset.etag);
  res.setHeader('Cache-Control', asset.cacheControl);
  res.setHeader('Vary', 'Accept-Encoding');

  if (req.headers['if-none-match'] === asset.etag) {
    res.writeHead(304).end();
    return;
  }

  const accept = String(req.headers['accept-encoding'] ?? '');
  let body = asset.raw;
  if (/\bbr\b/.test(accept)) {
    body = asset.br;
    res.setHeader('Content-Encoding', 'br');
  } else if (/\bgzip\b/.test(accept)) {
    body = asset.gzip;
    res.setHeader('Content-Encoding', 'gzip');
  }
  res.setHeader('Content-Length', body.length);
  res.writeHead(200).end(req.method === 'HEAD' ? undefined : body);
}
