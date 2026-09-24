import fs from 'node:fs';
import path from 'node:path';

/**
 * Minimal .env loader (no dependency). Precedence, highest first:
 *   real environment variables > .env.local > .env
 * Only keys prefixed with PUBLIC_ are ever exposed to browser code (see scripts/lib/bundle.ts).
 */
export function loadEnv(root: string = process.cwd()): Record<string, string> {
  return { ...loadEnvFiles(root), ...processEnv() };
}

/** Only the values from `.env` and `.env.local` in `root` (.env.local wins). */
export function loadEnvFiles(root: string): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const file of ['.env', '.env.local']) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    Object.assign(merged, parseEnv(fs.readFileSync(full, 'utf8')));
  }
  return merged;
}

export function processEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function publicEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith('PUBLIC_')));
}
