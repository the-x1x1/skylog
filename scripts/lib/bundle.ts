import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { publicEnv } from '../../server/env';

export const ROOT = path.resolve(import.meta.dirname, '../..');

export type WorkerRef = { kind: 'url'; url: string } | { kind: 'inline'; source: string };

export interface BundleOptions {
  mode: 'development' | 'production';
  /** Inline every asset (JS, CSS, fonts, workers) into one index.html. */
  singleFile: boolean;
  outdir: string;
  env: Record<string, string>;
  /** Dev only: include the live-reload client. */
  liveReload?: boolean;
  /** Hosted demo: emit a page fragment (no html/head/body), no downloads, sample preloaded. */
  demo?: boolean;
}

const WORKERS = {
  import: 'src/importers/worker/import.worker.ts',
  search: 'src/search/search.worker.ts',
} as const;

function defines(opts: BundleOptions, workers: Record<keyof typeof WORKERS, WorkerRef>) {
  const pub = publicEnv(opts.env);
  return {
    __APP_NAME__: JSON.stringify(pub.PUBLIC_APP_NAME ?? ''),
    __APP_VERSION__: JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version),
    __DEV__: JSON.stringify(opts.mode === 'development'),
    __DOWNLOADS_ENABLED__: JSON.stringify(!opts.demo),
    __AUTOLOAD_SAMPLE__: JSON.stringify(!!opts.demo),
    __IMPORT_WORKER__: JSON.stringify(workers.import),
    __SEARCH_WORKER__: JSON.stringify(workers.search),
    'process.env.NODE_ENV': JSON.stringify(opts.mode),
  };
}

function commonOptions(opts: BundleOptions): esbuild.BuildOptions {
  return {
    absWorkingDir: ROOT,
    bundle: true,
    target: ['es2022', 'chrome111', 'firefox115', 'safari16.4'],
    minify: opts.mode === 'production',
    sourcemap: opts.mode === 'development' ? 'inline' : false,
    legalComments: 'none',
    logLevel: 'warning',
    jsx: 'automatic',
    loader: { '.woff': opts.singleFile ? 'dataurl' : 'file', '.woff2': opts.singleFile ? 'dataurl' : 'file', '.svg': 'text' },
  };
}

async function buildWorkers(opts: BundleOptions): Promise<Record<keyof typeof WORKERS, WorkerRef>> {
  const result = {} as Record<keyof typeof WORKERS, WorkerRef>;
  const placeholder: Record<keyof typeof WORKERS, WorkerRef> = {
    import: { kind: 'url', url: '' },
    search: { kind: 'url', url: '' },
  };
  for (const [name, entry] of Object.entries(WORKERS) as [keyof typeof WORKERS, string][]) {
    const out = await esbuild.build({
      ...commonOptions(opts),
      entryPoints: { [`${name}-worker`]: entry },
      format: 'iife',
      write: !opts.singleFile,
      outdir: path.join(opts.outdir, 'assets'),
      entryNames: opts.mode === 'production' ? '[name]-[hash]' : '[name]',
      metafile: true,
      define: defines(opts, placeholder),
    });
    if (opts.singleFile) {
      const js = out.outputFiles?.find((f) => f.path.endsWith('.js'));
      if (!js) throw new Error(`worker ${name} produced no output`);
      result[name] = { kind: 'inline', source: js.text };
    } else {
      const jsOut = Object.keys(out.metafile?.outputs ?? {}).find((f) => f.endsWith('.js'));
      if (!jsOut) throw new Error(`worker ${name} produced no output`);
      result[name] = { kind: 'url', url: `./assets/${path.basename(jsOut)}` };
    }
  }
  return result;
}

function escapeInlineScript(js: string): string {
  return js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

function renderHtml(opts: BundleOptions, parts: { css: string; js: string; singleFile: boolean }): string {
  const template = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const appName = publicEnv(opts.env).PUBLIC_APP_NAME || 'Journal';
  const themeInit = fs.readFileSync(path.join(ROOT, 'public/theme-init.js'), 'utf8');
  const favicon = fs.readFileSync(path.join(ROOT, 'public/favicon.svg'), 'utf8');
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  const head: string[] = [];
  const body: string[] = [];
  if (parts.singleFile) {
    head.push(`<script>${escapeInlineScript(themeInit)}</script>`);
    head.push(`<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(favicon)}">`);
    head.push(`<style>${parts.css.replace(/<\/style/gi, '<\\/style')}</style>`);
    body.push(`<script type="module">${escapeInlineScript(parts.js)}</script>`);
  } else {
    head.push('<script src="./theme-init.js"></script>');
    head.push('<link rel="icon" type="image/svg+xml" href="./favicon.svg">');
    head.push(`<link rel="stylesheet" href="${parts.css}">`);
    body.push(`<script type="module" src="${parts.js}"></script>`);
    if (opts.liveReload) body.push('<script src="./dev-reload.js"></script>');
  }
  return template
    .replaceAll('%APP_NAME%', escapeHtml(appName))
    .replace('<!--head-->', head.join('\n    '))
    .replace('<!--body-->', body.join('\n    '));
}

/** A page fragment for hosts that supply their own document skeleton. */
function renderFragment(opts: BundleOptions, parts: { css: string; js: string }): string {
  const appName = publicEnv(opts.env).PUBLIC_APP_NAME || 'Journal';
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const themeInit = fs.readFileSync(path.join(ROOT, 'public/theme-init.js'), 'utf8');
  return [
    `<title>${escapeHtml(appName)}</title>`,
    `<meta name="description" content="${escapeHtml(appName)} — a private, local-first journal of your ChatGPT and Claude conversations.">`,
    '<meta name="color-scheme" content="light dark">',
    `<script>${escapeInlineScript(themeInit)}</script>`,
    `<style>${parts.css.replace(/<\/style/gi, '<\\/style')}</style>`,
    '<div id="root"></div>',
    `<script type="module">${escapeInlineScript(parts.js)}</script>`,
    '',
  ].join('\n');
}

export async function bundle(opts: BundleOptions): Promise<void> {
  fs.rmSync(opts.outdir, { recursive: true, force: true });
  fs.mkdirSync(path.join(opts.outdir, 'assets'), { recursive: true });

  const workers = await buildWorkers(opts);
  const app = await esbuild.build({
    ...commonOptions(opts),
    entryPoints: { app: 'src/main.tsx' },
    format: 'esm',
    write: !opts.singleFile,
    outdir: path.join(opts.outdir, 'assets'),
    entryNames: opts.mode === 'production' ? '[name]-[hash]' : '[name]',
    assetNames: '[name]-[hash]',
    metafile: true,
    define: defines(opts, workers),
  });

  if (opts.singleFile) {
    const js = app.outputFiles?.find((f) => f.path.endsWith('.js'))?.text ?? '';
    const css = app.outputFiles?.find((f) => f.path.endsWith('.css'))?.text ?? '';
    const html = opts.demo ? renderFragment(opts, { css, js }) : renderHtml(opts, { css, js, singleFile: true });
    fs.writeFileSync(path.join(opts.outdir, 'index.html'), html);
    fs.rmSync(path.join(opts.outdir, 'assets'), { recursive: true, force: true });
    return;
  }

  const outputs = Object.keys(app.metafile?.outputs ?? {});
  const jsFile = outputs.find((f) => f.endsWith('.js') && path.basename(f).startsWith('app'));
  const cssFile = outputs.find((f) => f.endsWith('.css'));
  if (!jsFile || !cssFile) throw new Error('app bundle missing js or css output');
  fs.writeFileSync(
    path.join(opts.outdir, 'index.html'),
    renderHtml(opts, { js: `./assets/${path.basename(jsFile)}`, css: `./assets/${path.basename(cssFile)}`, singleFile: false }),
  );
  for (const file of fs.readdirSync(path.join(ROOT, 'public'))) {
    fs.copyFileSync(path.join(ROOT, 'public', file), path.join(opts.outdir, file));
  }
}
