/* Build-time constants injected by scripts/lib/bundle.ts (esbuild `define`). */

type WorkerRef = { kind: 'url'; url: string } | { kind: 'inline'; source: string };

declare const __APP_NAME__: string;
declare const __APP_VERSION__: string;
declare const __DEV__: boolean;
declare const __IMPORT_WORKER__: WorkerRef;
declare const __SEARCH_WORKER__: WorkerRef;

declare module '*.woff' {
  const url: string;
  export default url;
}
declare module '*.svg' {
  const source: string;
  export default source;
}
declare module '*.css';
