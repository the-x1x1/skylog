/**
 * Normalizes the timestamp shapes found in exports to ISO strings:
 * epoch seconds (ChatGPT, often fractional), epoch milliseconds, and ISO/RFC strings (Claude).
 */
export function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    const ms = value < 1e11 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) return toIso(Number(trimmed));
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

export function maxIso(values: readonly (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const v of values) if (v && (!best || v > best)) best = v;
  return best;
}

export function minIso(values: readonly (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const v of values) if (v && (!best || v < best)) best = v;
  return best;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Undated';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Undated' : dateFmt.format(d);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return 'Undated';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Undated' : dateTimeFmt.format(d);
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : timeFmt.format(d);
}

/** Sortable month key, e.g. "2026-09"; "undated" when unknown. */
export function monthKey(iso: string | null | undefined): string {
  if (!iso) return 'undated';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'undated';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(key: string): string {
  if (key === 'undated') return 'Undated';
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return monthFmt.format(new Date(y, m - 1, 1));
}
