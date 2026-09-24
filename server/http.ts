import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { callLlm, getLlmStatus, LlmAdapterError, validateLlmBody } from './llm-adapter';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Content Security Policy for the served app. The browser may only talk to this origin and to
 * localhost (for an optional local Ollama summarizer). Conversation data therefore cannot be sent
 * to any third-party host from the browser, even by accident.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' http://localhost:* http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

export interface AppServerOptions {
  root: string;
  env: Record<string, string | undefined>;
  /** Dev only: server-sent-events endpoint that tells the page to reload after a rebuild. */
  liveReload?: { subscribe(fn: () => void): () => void };
  fetchImpl?: typeof fetch;
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new LlmAdapterError('Request body too large.', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

/**
 * The API is only for this app's own pages. Browsers always send Origin on cross-origin POSTs,
 * and the custom header forces a CORS preflight we never answer, so other websites cannot use a
 * locally configured API key.
 */
export function isTrustedApiRequest(req: http.IncomingMessage): boolean {
  if (req.headers['x-journal-client'] !== '1') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function createAppServer(opts: AppServerOptions): http.Server {
  const root = path.resolve(opts.root);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/api/llm/status' && req.method === 'GET') {
        if (!isTrustedApiRequest(req)) return sendJson(res, 403, { error: 'Forbidden' });
        return sendJson(res, 200, getLlmStatus(opts.env));
      }
      if (url.pathname === '/api/llm' && req.method === 'POST') {
        if (!isTrustedApiRequest(req)) return sendJson(res, 403, { error: 'Forbidden' });
        const body = validateLlmBody(JSON.parse(await readBody(req)));
        const controller = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) controller.abort();
        });
        const timeout = setTimeout(() => controller.abort(), 180_000);
        try {
          const result = await callLlm(body, opts.env, controller.signal, opts.fetchImpl);
          return sendJson(res, 200, result);
        } finally {
          clearTimeout(timeout);
        }
      }
      if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });

      if (url.pathname === '/__livereload' && opts.liveReload) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(': connected\n\n');
        const unsubscribe = opts.liveReload.subscribe(() => res.write('data: reload\n\n'));
        req.on('close', unsubscribe);
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405);
        return res.end();
      }
      return serveStatic(root, url.pathname, res, Boolean(opts.liveReload));
    } catch (err) {
      if (err instanceof LlmAdapterError) return sendJson(res, err.status, { error: err.message });
      if (err instanceof SyntaxError) return sendJson(res, 400, { error: 'Invalid JSON body.' });
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) return sendJson(res, 500, { error: message });
      res.end();
    }
  });
}

function serveStatic(root: string, pathname: string, res: http.ServerResponse, dev: boolean): void {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  let file = path.join(root, path.normalize(rel));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not built yet. Run npm run build first.');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const isHtml = ext === '.html';
  const hashed = /-[A-Z0-9]{8}\.[a-z0-9]+$/i.test(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': dev || isHtml || !hashed ? 'no-cache' : 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...(isHtml ? { 'content-security-policy': CONTENT_SECURITY_POLICY } : {}),
  });
  fs.createReadStream(file).pipe(res);
}
