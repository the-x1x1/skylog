/**
 * Builds the desktop program: a Node.js single executable application (SEA) that embeds the built
 * app and serves it on localhost (see server/launcher.ts).
 *
 *   npm run build:exe                 → release/<Name>-<version>-<os>-<arch>[.exe]
 *   npm run build:exe -- --with-html  → also the single-file app and SHA256SUMS.txt (what releases ship)
 *
 * The executable is made for the OS and CPU this runs on (the release workflow builds the Windows
 * .exe on a Windows runner). Needs Node 20.12+ and the `postject` dev dependency.
 * https://nodejs.org/api/single-executable-applications.html
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { loadEnv } from '../server/env';
import { bundle, ROOT } from './lib/bundle';

const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const withHtml = process.argv.includes('--with-html');
const started = Date.now();

const env = loadEnv(ROOT);
const displayName = env.PUBLIC_APP_NAME || 'Journal';
const fileStem = displayName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'Journal';
const version: string = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform;
const work = path.join(ROOT, '.build/exe');
const appDir = path.join(work, 'app');
const outDir = path.join(ROOT, 'release');

function step(message: string) {
  console.log(`• ${message}`);
}

function run(file: string, args: string[]) {
  execFileSync(file, args, { stdio: 'inherit' });
}

function listFiles(dir: string, prefix = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listFiles(path.join(dir, entry.name), rel) : [rel];
  });
}

function findSigntool(): string | null {
  const kits = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
  if (!fs.existsSync(kits)) return null;
  const versions = fs
    .readdirSync(kits)
    .filter((d) => /^10\.\d+\.\d+\.\d+$/.test(d))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of versions) {
    const candidate = path.join(kits, v, 'x64', 'signtool.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

step('Building the app');
await bundle({ mode: 'production', singleFile: false, outdir: appDir, env });

step('Bundling the launcher');
const launcher = path.join(work, 'launcher.cjs');
await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: ['server/launcher.ts'],
  outfile: launcher,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  legalComments: 'none',
  logLevel: 'warning',
  define: {
    __APP_NAME__: JSON.stringify(displayName),
    __APP_VERSION__: JSON.stringify(version),
  },
});

step('Preparing the executable payload');
const assets = Object.fromEntries(listFiles(appDir).map((rel) => [rel, path.join(appDir, rel)]));
const blob = path.join(work, 'sea-prep.blob');
const seaConfig = path.join(work, 'sea-config.json');
fs.writeFileSync(
  seaConfig,
  JSON.stringify({ main: launcher, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, assets }, null, 2),
);
run(process.execPath, ['--experimental-sea-config', seaConfig]);

const exeName = `${fileStem}-${version}-${osName}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`;
const exe = path.join(outDir, exeName);
step(`Creating ${path.relative(ROOT, exe)} from Node ${process.version}`);
fs.rmSync(exe, { force: true });
fs.copyFileSync(process.execPath, exe);
fs.chmodSync(exe, 0o755);

// The copied node binary carries Node's own signature, which injection invalidates. Strip it so the
// result is a plainly unsigned program rather than one with a broken signature.
if (process.platform === 'win32') {
  const signtool = findSigntool();
  if (signtool) run(signtool, ['remove', '/s', exe]);
  else console.warn('  signtool not found; leaving the copied signature in place (postject will warn).');
} else if (process.platform === 'darwin') {
  run('codesign', ['--remove-signature', exe]);
}

const postject = path.join(ROOT, 'node_modules/postject/dist/cli.js');
if (!fs.existsSync(postject)) {
  console.error('postject is not installed. Run `npm install` first.');
  process.exit(1);
}
run(process.execPath, [
  postject,
  exe,
  'NODE_SEA_BLOB',
  blob,
  '--sentinel-fuse',
  SEA_FUSE,
  ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : []),
]);
if (process.platform === 'darwin') run('codesign', ['--sign', '-', exe]);

const shipped = [exe];
if (withHtml) {
  step('Building the single-file app');
  const singleDir = path.join(work, 'single');
  await bundle({ mode: 'production', singleFile: true, outdir: singleDir, env });
  const html = path.join(outDir, `${fileStem}-${version}.html`);
  fs.copyFileSync(path.join(singleDir, 'index.html'), html);
  shipped.push(html);

  const sums = shipped.map((file) => `${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${path.basename(file)}`);
  fs.writeFileSync(path.join(outDir, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
  shipped.push(path.join(outDir, 'SHA256SUMS.txt'));
}

for (const file of shipped) console.log(`  ${path.relative(ROOT, file)}  (${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
