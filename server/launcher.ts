/**
 * Entry point of the desktop program (the .exe attached to each release). scripts/build-exe.ts
 * bundles this file into a Node.js single executable application with the built app embedded.
 *
 * It serves the journal at http://localhost:4173 and opens it in the default browser. Imported
 * conversations stay in that browser's storage; this program keeps no data of its own. API keys for
 * the optional summarizer are read from a .env.local file next to the program.
 *
 * Run from source (serves ./dist): npm run build && npx tsx server/launcher.ts
 */
import path from 'node:path';
import * as sea from 'node:sea';
import { DEFAULT_PORT, desktopEnv, openBrowser, resolvePort, startDesktopServer } from './desktop';
import { directoryFiles, type StaticFiles } from './http';
import { getLlmStatus } from './llm-adapter';

const NAME = typeof __APP_NAME__ === 'string' && __APP_NAME__ ? __APP_NAME__ : 'Journal';
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** Files embedded in the executable by scripts/build-exe.ts, keyed by their path inside dist/. */
function embeddedFiles(): StaticFiles {
  const cache = new Map<string, Buffer>();
  return {
    read(relPath) {
      const hit = cache.get(relPath);
      if (hit) return hit;
      try {
        const data = Buffer.from(sea.getAsset(relPath));
        cache.set(relPath, data);
        return data;
      } catch {
        return null;
      }
    },
  };
}

async function waitForEnterIfInteractive(): Promise<void> {
  if (!process.stdin.isTTY) return;
  console.log('\nPress Enter to close this window.');
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => resolve());
  });
}

async function fail(lines: string[]): Promise<void> {
  for (const line of lines) console.error(line);
  process.exitCode = 1;
  await waitForEnterIfInteractive();
  process.exit(1);
}

async function main(): Promise<void> {
  const packaged = sea.isSea();
  const baseDir = packaged ? path.dirname(process.execPath) : process.cwd();
  const env = desktopEnv(baseDir, NAME);
  const noBrowser = process.argv.includes('--no-browser') || /^(1|true|yes)$/i.test(env.NO_BROWSER ?? '');
  const files = packaged ? embeddedFiles() : directoryFiles(env.APP_DIST_DIR ?? path.join(baseDir, 'dist'));
  const envFile = path.join(baseDir, '.env.local');

  let port: number;
  try {
    port = resolvePort(env);
  } catch (err) {
    return fail([`${NAME} can't start: ${(err as Error).message}`, `Fix PORT in ${envFile}.`]);
  }

  const result = await startDesktopServer({ files, env, port, version: VERSION });

  if (result.kind === 'port-busy') {
    return fail([
      `${NAME} can't start: port ${port} is in use by another program or reserved by Windows.`,
      'Close the other program (or restart your computer) and open this one again.',
      `Or pick another port by adding a line like PORT=4180 to ${envFile}.`,
      'Note: your journal is stored per address, so a new port starts with an empty journal.',
      'Move entries across with Settings → Back up journal / Restore from backup.',
    ]);
  }

  if (result.kind === 'already-running') {
    console.log(`${NAME} is already running. Opening ${result.url} …`);
    if (noBrowser || !(await openBrowser(result.url))) console.log(`Open ${result.url} in your browser.`);
    setTimeout(() => process.exit(0), 1500);
    return;
  }

  const llm = getLlmStatus(env);
  console.log('');
  console.log(`  ${NAME} ${VERSION}`);
  console.log(`  Your journal: ${result.url}`);
  if (port !== DEFAULT_PORT) console.log(`  (Port ${port} is set by PORT. The journal is stored per port, so other ports show different journals.)`);
  console.log(
    llm.available
      ? `  Summaries: ready (${llm.vendor}, ${llm.model})`
      : `  Summaries: off. To turn them on, put ANTHROPIC_API_KEY=... or OPENAI_API_KEY=... in ${envFile} and restart.`,
  );
  console.log('');
  console.log(`  Keep this window open while you use ${NAME}. Close it (or press Ctrl+C) to quit.`);
  console.log('  Your entries are saved in your browser and are still there next time.');
  console.log('');

  if (!noBrowser && !(await openBrowser(result.url))) console.log(`Open ${result.url} in your browser.`);

  const stop = () => process.exit(0);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err: unknown) => fail([`${NAME} stopped unexpectedly: ${err instanceof Error ? err.message : String(err)}`]));
