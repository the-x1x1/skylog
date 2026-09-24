/**
 * Starts the executable built by `npm run build:exe` and checks it serves the embedded app:
 * the page, one of its hashed assets, and the /api/app identity endpoint. Used by CI and the
 * release workflow before anything is attached to a release.
 *
 *   npm run smoke:exe
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/bundle';

const PORT = Number(process.env.SMOKE_PORT ?? 4388);
const base = `http://127.0.0.1:${PORT}`;
const releaseDir = path.join(ROOT, 'release');
const suffix = process.platform === 'win32' ? '.exe' : '';
const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform;

const exeName = fs.existsSync(releaseDir)
  ? fs.readdirSync(releaseDir).find((f) => f.endsWith(`-${osName}-${process.arch}${suffix}`))
  : undefined;
if (!exeName) {
  console.error(`No executable for ${osName}-${process.arch} in release/. Run npm run build:exe first.`);
  process.exit(1);
}
const exe = path.join(releaseDir, exeName);

const child = spawn(exe, ['--no-browser'], {
  env: { ...process.env, PORT: String(PORT), NO_BROWSER: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (d: Buffer) => (output += d.toString()));
child.stderr.on('data', (d: Buffer) => (output += d.toString()));
let exited: number | null = null;
child.on('exit', (code) => (exited = code ?? -1));

async function get(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text() };
}

function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

try {
  let page: Awaited<ReturnType<typeof get>> | null = null;
  for (let i = 0; i < 60 && !page; i++) {
    await new Promise((r) => setTimeout(r, 500));
    check(exited === null, `The executable exited early (code ${exited}).`);
    page = await get(`${base}/`).catch(() => null);
  }
  check(page, 'The executable did not start serving within 30 seconds.');
  check(page.status === 200 && page.body.includes('<div id="root"></div>'), 'The app page was not served.');

  const script = page.body.match(/assets\/app-[A-Za-z0-9]+\.js/)?.[0];
  check(script, 'The app page does not reference its script.');
  const js = await get(`${base}/${script}`);
  check(js.status === 200 && /javascript/.test(js.type) && js.body.length > 10_000, `Embedded asset ${script} was not served.`);

  const deep = await get(`${base}/entry/some-entry`);
  check(deep.status === 200 && deep.body.includes('<div id="root"></div>'), 'Deep links do not fall back to the app page.');

  const info = JSON.parse((await get(`${base}/api/app`, { 'x-journal-client': '1' })).body) as { app?: string; version?: string };
  check(info.app === 'conversation-journal', `Unexpected /api/app response: ${JSON.stringify(info)}`);

  const mb = (fs.statSync(exe).size / 1024 / 1024).toFixed(0);
  console.log(`Smoke test passed: ${exeName} (${mb} MB) serves the app, its assets and /api/app (version ${info.version}).`);
} catch (err) {
  console.error(`Smoke test failed: ${(err as Error).message}`);
  if (output) console.error(`--- executable output ---\n${output}`);
  process.exitCode = 1;
} finally {
  child.kill();
}
