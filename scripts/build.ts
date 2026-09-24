import path from 'node:path';
import { loadEnv } from '../server/env';
import { bundle, ROOT } from './lib/bundle';

const singleFile = process.argv.includes('--single-file');
const outdir = path.join(ROOT, singleFile ? 'dist-single' : 'dist');
const started = Date.now();

await bundle({ mode: 'production', singleFile, outdir, env: loadEnv(ROOT) });

console.log(`Built ${singleFile ? 'single-file app' : 'app'} into ${path.relative(ROOT, outdir)}/ in ${Date.now() - started} ms`);
