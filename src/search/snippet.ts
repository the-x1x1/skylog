import type { Segment } from './types';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Builds a regex that matches any of the terms at the start of a word (case-insensitive). */
export function termsRegex(terms: readonly string[]): RegExp | null {
  const clean = Array.from(new Set(terms.map((t) => t.trim()).filter((t) => t.length > 0))).sort((a, b) => b.length - a.length);
  if (clean.length === 0) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(${clean.map(escapeRegExp).join('|')})`, 'giu');
}

/** Splits text into plain and matched segments (for rendering <mark> safely, without HTML). */
export function highlight(text: string, terms: readonly string[]): Segment[] {
  const re = termsRegex(terms);
  if (!re || !text) return [{ text, match: false }];
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    // Extend the highlight to the end of the word so prefix matches read naturally.
    let end = start + m[0].length;
    while (end < text.length && /[\p{L}\p{N}]/u.test(text[end]!)) end++;
    if (start > last) out.push({ text: text.slice(last, start), match: false });
    out.push({ text: text.slice(start, end), match: true });
    last = end;
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false });
  return out.length ? out : [{ text, match: false }];
}

/**
 * A window of `radius` characters around the first match, with ellipses, highlighted.
 * Whitespace is collapsed so snippets stay on one or two lines.
 */
export function makeSnippet(text: string, terms: readonly string[], radius = 90): Segment[] {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return [];
  const re = termsRegex(terms);
  const first = re ? re.exec(flat) : null;
  if (!first) {
    const cut = flat.length > radius * 2 ? `${flat.slice(0, radius * 2).trimEnd()}…` : flat;
    return [{ text: cut, match: false }];
  }
  const at = first.index;
  let start = Math.max(0, at - radius);
  let end = Math.min(flat.length, at + radius * 1.4);
  if (start > 0) {
    const space = flat.indexOf(' ', start);
    if (space > 0 && space < at) start = space + 1;
  }
  if (end < flat.length) {
    const space = flat.lastIndexOf(' ', end);
    if (space > at) end = space;
  }
  const window = `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
  return highlight(window, terms);
}

/** Splits a raw query into words, as the search engine does. */
export function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}
