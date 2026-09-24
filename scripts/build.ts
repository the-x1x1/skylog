import path from 'node:path';
import { loadEnv } from '../server/env';
import { bundle, ROOT } from './lib/bundle';

const demo = process.argv.includes('--demo');
const singleFile = demo || process.argv.includes('--single-file');
const outdir = path.join(ROOT, demo ? 'dist-demo' : singleFile ? 'dist-single' : 'dist');
const started = Date.now();

await bundle({ mode: 'production', singleFile, demo, outdir, env: loadEnv(ROOT) });

console.log(`Built ${demo ? 'hosted demo' : singleFile ? 'single-file app' : 'app'} into ${path.relative(ROOT, outdir)}/ in ${Date.now() - started} ms`);
