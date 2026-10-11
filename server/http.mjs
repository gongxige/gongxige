// Small helpers shared by the game server (server.mjs) and the mock operator
// (mock-operator.mjs): JSON responses, body reading and request signing.
//
// Every server-to-server call carries `X-Signature: <hex HMAC-SHA256 of the
// raw body>` made with the secret both sides agreed on. The receiver
// recomputes it and rejects the call if it differs, so nobody without the
// secret can move money or open game sessions. See docs/PROVIDER_API.md.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function sign(body, secret) {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function verify(body, signature, secret) {
  const expected = Buffer.from(sign(body, secret), 'hex');
  const given = Buffer.from(String(signature ?? ''), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function html(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

/** Reads the raw request body (as text; signatures are checked on the exact bytes). */
export function readRaw(req, limit = 32_000) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > limit) { reject(new Error('Request too large')); req.destroy(); } });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export function parseJson(raw) {
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error('Invalid JSON'); }
}

/** POSTs JSON with a signature. Resolves { status, body }; rejects on network error or timeout. */
export async function signedPost(url, payload, { secret, operatorId, timeoutMs = 5000 }) {
  const raw = JSON.stringify(payload);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-operator-id': operatorId, 'x-signature': sign(raw, secret) },
    body: raw,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Writes a file atomically (temp file + rename) so a crash never leaves half a JSON file. */
export function writeJsonAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, JSON.stringify(data, null, 2));
  renameSync(temp, path);
}
