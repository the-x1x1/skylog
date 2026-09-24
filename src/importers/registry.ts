import type { Source } from '../data/types';
import { chatgptImporter } from './chatgpt/importer';
import { claudeImporter } from './claude/importer';
import type { ConversationImporter } from './core/types';

/**
 * Registered importers. New sources (official APIs, a watched export folder, desktop
 * integrations) plug in here by implementing ConversationImporter; the data model, pipeline
 * and UI stay unchanged.
 */
export const IMPORTERS: readonly ConversationImporter[] = [chatgptImporter, claudeImporter];

export function importerFor(source: Source): ConversationImporter {
  const imp = IMPORTERS.find((i) => i.source === source);
  if (!imp) throw new Error(`No importer for ${source}`);
  return imp;
}
