import { useSyncExternalStore } from 'react';

/**
 * Tiny hash router. Hash URLs work from any static host, a local file, or the local server
 * without rewrite rules, and give every entry/image/message a shareable deep link.
 *   #/                       journal
 *   #/entry/:id?image=…      entry with an image selected
 *   #/entry/:id?message=…    entry scrolled to a message
 *   #/search?q=…             search
 */

export interface RouteLocation {
  path: string;
  query: URLSearchParams;
  raw: string;
}

const listeners = new Set<() => void>();

function currentHash(): string {
  return typeof location === 'undefined' ? '' : location.hash;
}

function notify() {
  for (const fn of listeners) fn();
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', notify);
  window.addEventListener('popstate', notify);
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function parseHash(hash: string): RouteLocation {
  const raw = hash.replace(/^#/, '') || '/';
  const q = raw.indexOf('?');
  const path = (q >= 0 ? raw.slice(0, q) : raw) || '/';
  return { path: path.startsWith('/') ? path : `/${path}`, query: new URLSearchParams(q >= 0 ? raw.slice(q + 1) : ''), raw };
}

let cachedHash = '';
let cachedLocation: RouteLocation = parseHash('');

export function useLocation(): RouteLocation {
  const hash = useSyncExternalStore(subscribe, currentHash, () => '');
  if (hash !== cachedHash) {
    cachedHash = hash;
    cachedLocation = parseHash(hash);
  }
  return cachedLocation;
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const target = `#${to.startsWith('/') ? to : `/${to}`}`;
  if (target === location.hash) return;
  // History API + synchronous notify, so state updates before the next keystroke/event.
  if (opts.replace) history.replaceState(history.state, '', target);
  else history.pushState(null, '', target);
  notify();
}

export function href(to: string): string {
  return `#${to}`;
}

export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const a = path.split('/').filter(Boolean);
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    const val = a[i]!;
    if (seg.startsWith(':')) {
      try {
        params[seg.slice(1)] = decodeURIComponent(val);
      } catch {
        return null;
      }
    } else if (seg !== val) return null;
  }
  return params;
}

export function withQuery(path: string, params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

export function entryPath(entryId: string, extra: { image?: string; message?: string } = {}): string {
  return withQuery(`/entry/${encodeURIComponent(entryId)}`, extra);
}
