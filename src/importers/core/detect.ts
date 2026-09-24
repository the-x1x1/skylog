import type { Source } from '../../data/types';
import type { ArchiveManifest, ConversationImporter } from './types';

export interface DetectionResult {
  source: Source | null;
  ambiguous: boolean;
  scores: { source: Source; score: number; reasons: string[] }[];
}

/**
 * Picks the importer whose signals are strongest. Detection is "ambiguous" when no importer
 * recognizes the archive or two importers score equally — the UI then asks the user to choose.
 */
export function detectSource(manifest: ArchiveManifest, importers: readonly ConversationImporter[]): DetectionResult {
  const scores = importers
    .map((imp) => ({ source: imp.source, ...imp.score(manifest) }))
    .sort((a, b) => b.score - a.score);
  const best = scores[0];
  const second = scores[1];
  if (!best || best.score <= 0) return { source: null, ambiguous: true, scores };
  if (second && second.score === best.score) return { source: null, ambiguous: true, scores };
  return { source: best.source, ambiguous: best.score < 3, scores };
}
