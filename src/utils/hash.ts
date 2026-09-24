/** FNV-1a 32-bit hash; stable, fast, dependency-free. Not for security. */
export function fnv1a(input: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function hashParts(parts: readonly (string | number | null | undefined)[]): string {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h = fnv1a(String(p ?? '\u0000'), h);
    h = fnv1a('␞', h);
  }
  return h.toString(36);
}

export function randomId(prefix = ''): string {
  const c = globalThis.crypto;
  const core =
    c && typeof c.randomUUID === 'function'
      ? c.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${core}` : core;
}
