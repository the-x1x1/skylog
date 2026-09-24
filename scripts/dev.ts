import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../server/env';
import { createAppServer } from '../server/http';
import { bundle, ROOT } from './lib/bundle';

/**
 * Dev server: rebuilds on change (esbuild is fast enough that a full rebuild is simpler than
 * incremental contexts across three bundles) and live-reloads the page. Also hosts /api/llm so
 * the optional summarizer works in development exactly like in `npm start`.
 */
const env = loadEnv(ROOT);
const outdir = path.join(ROOT, '.dev');
const port = Number(env.DEV_PORT ?? 5173);

const listeners = new Set<() => void>();
const liveReload = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

const RELOAD_CLIENT = `(() => { const es = new EventSource('/__livereload'); es.onmessage = () => location.reload(); })();`;

async function rebuild(reason: string) {
  const started = Date.now();
  try {
    await bundle({ mode: 'development', singleFile: false, outdir, env, liveReload: true });
    fs.writeFileSync(path.join(outdir, 'dev-reload.js'), RELOAD_CLIENT);
    console.log(`[dev] built (${reason}) in ${Date.now() - started} ms`);
    for (const fn of listeners) fn();
  } catch (err) {
    console.error('[dev] build failed:', err instanceof Error ? err.message : err);
  }
}

await rebuild('startup');

let timer: NodeJS.Timeout | null = null;
for (const dir of ['src', 'public', 'index.html']) {
  fs.watch(path.join(ROOT, dir), { recursive: true }, (_event, file) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void rebuild(String(file ?? dir)), 80);
  });
}

createAppServer({ root: outdir, env, liveReload }).listen(port, '127.0.0.1', () => {
  console.log(`[dev] ${env.PUBLIC_APP_NAME ?? 'app'} running at http://localhost:${port}`);
});
