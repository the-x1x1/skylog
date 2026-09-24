import { spawn } from 'node:child_process';
import type http from 'node:http';
import { loadEnvFiles, processEnv } from './env';
import { APP_ID, createAppServer, type StaticFiles } from './http';

/**
 * Logic behind the desktop program (server/launcher.ts): serve the app on a fixed loopback port and
 * open it in the user's browser.
 *
 * The port is fixed on purpose. The journal lives in the browser's storage for the page's origin
 * (http://localhost:PORT), so starting on a different port would show an empty journal.
 */

export const DEFAULT_PORT = 4173;

export type StartResult =
  | { kind: 'started'; url: string; server: http.Server }
  | { kind: 'already-running'; url: string }
  | { kind: 'port-busy'; port: number };

export interface StartOptions {
  files: StaticFiles;
  env: Record<string, string | undefined>;
  port: number;
  version: string;
}

/**
 * Settings for the desktop program. Unlike the dev server, the .env.local file next to the program
 * wins over environment variables: it is what the user edits, and a system-wide PORT left behind by
 * another tool must not silently move the journal to a different (empty) origin.
 */
export function desktopEnv(baseDir: string, appName: string, env: Record<string, string> = processEnv()): Record<string, string> {
  return { PUBLIC_APP_NAME: appName, ...env, ...loadEnvFiles(baseDir) };
}

/** Listen errors that mean "this port can't be used right now" rather than a bug. */
export function isPortUnavailable(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  // EACCES: Windows reserves port ranges for Hyper-V / WSL, and binding inside one is refused.
  return code === 'EADDRINUSE' || code === 'EACCES';
}

export function appUrl(port: number): string {
  return `http://localhost:${port}`;
}

export function resolvePort(env: Record<string, string | undefined>): number {
  const raw = env.PORT?.trim();
  if (!raw) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`PORT must be a number from 1 to 65535 (got "${raw}").`);
  return port;
}

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

/** True when the server on `port` is this app (a copy started earlier), not some other program. */
export async function isAppRunningOn(port: number, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}/api/app`, {
      headers: { 'x-journal-client': '1' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const info = (await res.json()) as { app?: unknown };
    return info.app === APP_ID;
  } catch {
    return false;
  }
}

export async function startDesktopServer(opts: StartOptions): Promise<StartResult> {
  const server = createAppServer({ files: opts.files, env: opts.env, version: opts.version });
  try {
    await listen(server, opts.port);
    return { kind: 'started', url: appUrl(opts.port), server };
  } catch (err) {
    if (!isPortUnavailable(err)) throw err;
    if (await isAppRunningOn(opts.port)) return { kind: 'already-running', url: appUrl(opts.port) };
    return { kind: 'port-busy', port: opts.port };
  }
}

/** Opens `url` in the default browser. Returns false if no opener could be started. */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  const [command, args] =
    platform === 'win32'
      ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
      : platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
