/**
 * Runs the browser suite against the built desktop program instead of the dev server:
 *   npm run build:exe && npm run test:e2e:exe
 */
import fs from 'node:fs';
import path from 'node:path';
import base from './playwright.config';

const releaseDir = path.join(import.meta.dirname, 'release');
const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform;
const suffix = `-${osName}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`;
const exe = fs.existsSync(releaseDir) ? fs.readdirSync(releaseDir).find((f) => f.endsWith(suffix)) : undefined;
if (!exe) throw new Error(`No executable ending in ${suffix} in release/. Run npm run build:exe first.`);

export default {
  ...base,
  webServer: {
    ...base.webServer,
    command: `"${path.join(releaseDir, exe)}" --no-browser`,
    env: { PORT: '4199', NO_BROWSER: '1', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' },
  },
};
