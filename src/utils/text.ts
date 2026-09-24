export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Truncates at a word boundary and appends an ellipsis when shortened. */
export function truncateAtWord(input: string, max: number): string {
  const s = normalizeWhitespace(input);
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : s.slice(0, max);
  return `${base.replace(/[\s,.;:!?-]+$/, '')}…`;
}

/** Strips markdown/code noise to get a readable one-liner from a message. */
export function plainOneLine(text: string): string {
  return normalizeWhitespace(
    text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/[*_~>]+/g, ' '),
  );
}

const GREETING_ONLY = /^(hi|hey|hello|yo|ok|okay|thanks|thank you|thx|sure|yes|no|continue|go on|\.+)[\s!.?]*$/i;

/** First user message that carries meaning (skips greetings and empty/very short turns). */
export function firstMeaningfulText(texts: readonly string[]): string | null {
  for (const t of texts) {
    const line = plainOneLine(t);
    if (line.length >= 3 && !GREETING_ONLY.test(line)) return line;
  }
  return null;
}

export function slugify(s: string, max = 60): string {
  const slug = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'entry';
}

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? singular : plural}`;
}

export function normalizeTag(tag: string): string {
  return normalizeWhitespace(tag.toLowerCase().replace(/^#/, '').replace(/[^\p{L}\p{N}\s-]/gu, '')).slice(0, 32);
}

export function uniqueTags(tags: readonly string[], max = 8): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const n = normalizeTag(t);
    if (n && !out.includes(n)) out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
