import { normalizeWhitespace, truncateAtWord, uniqueTags } from '../utils/text';
import type { JournalSummary, SourcedText } from './types';

export type ValidationResult = { ok: true; value: JournalSummary; warnings: string[] } | { ok: false; error: string };

/** Pulls a JSON object out of a model reply (tolerates code fences and leading prose). */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new Error('Reply was not valid JSON.');
  }
}

/**
 * Validates a model reply against the JournalSummary schema and maps message references
 * ("m12") back to real message ids. Unknown references are dropped rather than trusted.
 */
export function validateSummary(raw: unknown, refToId: ReadonlyMap<string, string>): ValidationResult {
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Expected a JSON object at the top level.' };
  const r = raw as Record<string, unknown>;

  const resolveRef = (v: unknown): string | null => {
    if (typeof v === 'number') v = `m${v}`;
    if (typeof v !== 'string') return null;
    const key = v.trim().replace(/^\[|\]$/g, '');
    const normalized = /^\d+$/.test(key) ? `m${key}` : key.toLowerCase();
    return refToId.get(normalized) ?? refToId.get(key) ?? null;
  };
  const resolveRefs = (v: unknown, where: string): string[] | null => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) return null;
    const ids: string[] = [];
    for (const ref of v) {
      const id = resolveRef(ref);
      if (id) {
        if (!ids.includes(id)) ids.push(id);
      } else warnings.push(`Dropped unknown message reference ${JSON.stringify(ref)} in ${where}.`);
    }
    return ids;
  };

  if (typeof r.title !== 'string' || !normalizeWhitespace(r.title)) return { ok: false, error: '"title" must be a non-empty string.' };
  if (typeof r.summary !== 'string' || !normalizeWhitespace(r.summary)) return { ok: false, error: '"summary" must be a non-empty string.' };
  if (r.subtitle !== undefined && r.subtitle !== null && typeof r.subtitle !== 'string') return { ok: false, error: '"subtitle" must be a string.' };
  if (r.tags !== undefined && !Array.isArray(r.tags)) return { ok: false, error: '"tags" must be an array of strings.' };

  const sourced = (key: 'keyDecisions' | 'nextSteps'): SourcedText[] | string => {
    const v = r[key];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) return `"${key}" must be an array.`;
    const out: SourcedText[] = [];
    for (const item of v) {
      const text = typeof item === 'string' ? item : item && typeof item === 'object' ? (item as Record<string, unknown>).text : null;
      if (typeof text !== 'string') return `Each item in "${key}" needs a "text" string.`;
      const refs = typeof item === 'object' ? resolveRefs((item as Record<string, unknown>).sourceMessageIds, key) : [];
      if (refs === null) return `"sourceMessageIds" in "${key}" must be an array.`;
      const clean = normalizeWhitespace(text);
      if (clean) out.push({ text: truncateAtWord(clean, 280), sourceMessageIds: refs });
    }
    return out.slice(0, 10);
  };
  const keyDecisions = sourced('keyDecisions');
  if (typeof keyDecisions === 'string') return { ok: false, error: keyDecisions };
  const nextSteps = sourced('nextSteps');
  if (typeof nextSteps === 'string') return { ok: false, error: nextSteps };

  const highlights: { messageId: string }[] = [];
  if (r.highlights !== undefined && r.highlights !== null) {
    if (!Array.isArray(r.highlights)) return { ok: false, error: '"highlights" must be an array.' };
    for (const h of r.highlights) {
      const ref = h && typeof h === 'object' ? (h as Record<string, unknown>).messageId : h;
      const id = resolveRef(ref);
      if (id && !highlights.some((x) => x.messageId === id)) highlights.push({ messageId: id });
      else if (!id) warnings.push(`Dropped unknown highlight reference ${JSON.stringify(ref)}.`);
    }
  }

  const extractedLists: JournalSummary['extractedLists'] = [];
  if (r.extractedLists !== undefined && r.extractedLists !== null) {
    if (!Array.isArray(r.extractedLists)) return { ok: false, error: '"extractedLists" must be an array.' };
    for (const list of r.extractedLists) {
      if (!list || typeof list !== 'object') return { ok: false, error: 'Each extracted list must be an object.' };
      const l = list as Record<string, unknown>;
      if (typeof l.heading !== 'string' || !Array.isArray(l.rows)) return { ok: false, error: 'Each extracted list needs "heading" and "rows".' };
      const rows: JournalSummary['extractedLists'][number]['rows'] = [];
      for (const row of l.rows) {
        if (!row || typeof row !== 'object') continue;
        const rr = row as Record<string, unknown>;
        const label = typeof rr.label === 'string' ? normalizeWhitespace(rr.label) : '';
        const value = typeof rr.value === 'string' || typeof rr.value === 'number' ? normalizeWhitespace(String(rr.value)) : '';
        const refs = resolveRefs(rr.sourceMessageIds, 'extractedLists') ?? [];
        if (label) rows.push({ label: label.slice(0, 120), value: value.slice(0, 200), sourceMessageIds: refs });
      }
      if (rows.length > 0) extractedLists.push({ heading: normalizeWhitespace(l.heading).slice(0, 80) || 'List', rows: rows.slice(0, 60) });
    }
  }

  const suggested = typeof r.suggestedCollection === 'string' ? normalizeWhitespace(r.suggestedCollection).slice(0, 48) : '';

  return {
    ok: true,
    warnings,
    value: {
      title: truncateAtWord(r.title, 90),
      subtitle: typeof r.subtitle === 'string' ? truncateAtWord(r.subtitle, 180) : '',
      summary: normalizeWhitespace(r.summary).length > 2000 ? truncateAtWord(r.summary, 2000) : r.summary.trim(),
      tags: uniqueTags((Array.isArray(r.tags) ? r.tags : []).filter((t): t is string => typeof t === 'string'), 6),
      keyDecisions,
      nextSteps,
      highlights: highlights.slice(0, 5),
      extractedLists: extractedLists.slice(0, 4),
      suggestedCollection: suggested || null,
    },
  };
}
