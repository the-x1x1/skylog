import { notifyChange } from '../data/db/changes';
import { createMemoryArchive } from '../importers/core/archive';
import { conversationIdFor, entryIdFor } from '../importers/core/prepare';
import { runImport } from '../importers/core/pipeline';
import { importerFor } from '../importers/registry';
import { applySummary } from '../summarization/service';
import type { JournalSummary } from '../summarization/types';
import { GARDEN_ID, HOLOGRAM_ID, sampleChatGptExportFiles, sampleClaudeExportFiles } from './sample-exports';

/**
 * Pre-written summaries for the sample journal, clearly labelled "Sample data" in the UI.
 * Message references use source message ids and are mapped to stored ids below.
 * The sourdough sample deliberately has no summary, to show the "Summary not generated" state.
 */
const SAMPLE_SUMMARIES: Record<string, { source: 'chatgpt' | 'claude'; summary: JournalSummary }> = {
  [HOLOGRAM_ID]: {
    source: 'chatgpt',
    summary: {
      title: 'Tabletop hologram display',
      subtitle: "A Pepper's ghost pyramid for an 11-inch iPad, hidden in a walnut box.",
      summary:
        "Planned a desk-sized Pepper's ghost display: four clear panels at 45° over an iPad playing a four-way video. Settled on 1 mm PETG over acrylic for a first build, sized the pyramid to a 15 cm base, and moved the iPad into a walnut box so only the pyramid shows. Two concept renders were generated, and a 20 cm box was confirmed to fit beside the monitor stand.",
      tags: ['hologram', 'woodworking', 'desk setup'],
      keyDecisions: [
        { text: 'Use 1 mm clear PETG instead of 2 mm acrylic for the first build.', sourceMessageIds: ['holo-m03', 'holo-m04'] },
        { text: 'Pyramid panels: trapezoids with a 15 cm bottom edge, 1.5 cm top edge and 8.5 cm height.', sourceMessageIds: ['holo-m03'] },
        { text: 'Hide the iPad inside a walnut box so only the pyramid is visible.', sourceMessageIds: ['holo-m08'] },
        { text: 'A 20 × 20 cm box fits to the left of the monitor stand.', sourceMessageIds: ['holo-m10', 'holo-m11'] },
      ],
      nextSteps: [
        { text: 'Print the trapezoid template and cut one test panel.', sourceMessageIds: ['holo-m15', 'holo-m16'] },
        { text: 'Find a four-way jellyfish video and check the 45° angle on the iPad.', sourceMessageIds: ['holo-m15', 'holo-m16'] },
      ],
      highlights: [{ messageId: 'holo-m03' }, { messageId: 'holo-m09' }],
      extractedLists: [
        {
          heading: 'Parts and materials',
          rows: [
            { label: '1 mm clear PETG sheet, A4', value: '1 sheet', sourceMessageIds: ['holo-m09'] },
            { label: 'Walnut board, 12 × 300 × 300 mm', value: '1', sourceMessageIds: ['holo-m09'] },
            { label: 'Clear UV-cure glue', value: '1 tube', sourceMessageIds: ['holo-m09'] },
            { label: 'Black matte vinyl, 20 × 30 cm', value: '1', sourceMessageIds: ['holo-m09'] },
            { label: 'Neodymium magnets, 6 × 2 mm', value: '4', sourceMessageIds: ['holo-m09'] },
            { label: 'Felt pads', value: '4', sourceMessageIds: ['holo-m09'] },
          ],
        },
      ],
      suggestedCollection: 'Workshop projects',
    },
  },
  [GARDEN_ID]: {
    source: 'claude',
    summary: {
      title: 'Raised beds for the side yard',
      subtitle: 'Two cedar beds, a trellis for tomatoes, and 650 litres of soil.',
      summary:
        'Laid out a 3 m side strip as two 1.2 × 0.9 m raised beds with a gravel path. The layout was revised to put cherry tomatoes at the far end with a trellis and herbs by the door. Soil works out to about 650 litres of a 60/30/10 topsoil, compost and perlite mix.',
      tags: ['garden', 'raised beds', 'planning'],
      keyDecisions: [
        { text: 'Two 1.2 × 0.9 m beds, 30 cm deep, with a 0.5 m gravel path.', sourceMessageIds: ['garden-m01', 'garden-m03'] },
        { text: 'Tomatoes at the far end with a trellis; herbs next to the door.', sourceMessageIds: ['garden-m04', 'garden-m05'] },
        { text: 'Build the beds from untreated cedar.', sourceMessageIds: ['garden-m08'] },
      ],
      nextSteps: [
        { text: 'Buy about 715 L of soil mix (650 L plus 10% for settling).', sourceMessageIds: ['garden-m07'] },
        { text: 'Plant lettuce first, then herbs, then transplant tomatoes once the soil warms.', sourceMessageIds: ['garden-m09'] },
      ],
      highlights: [{ messageId: 'garden-m07' }],
      extractedLists: [
        {
          heading: 'Soil mix for both beds',
          rows: [
            { label: 'Topsoil', value: '390 L', sourceMessageIds: ['garden-m07'] },
            { label: 'Compost', value: '195 L', sourceMessageIds: ['garden-m07'] },
            { label: 'Perlite', value: '65 L', sourceMessageIds: ['garden-m07'] },
          ],
        },
      ],
      suggestedCollection: 'Home & garden',
    },
  },
};

function mapIds(summary: JournalSummary, conversationId: string): JournalSummary {
  const id = (sourceMessageId: string) => `${conversationId}:${sourceMessageId}`;
  const mapItems = (items: JournalSummary['keyDecisions']) => items.map((i) => ({ ...i, sourceMessageIds: i.sourceMessageIds.map(id) }));
  return {
    ...summary,
    keyDecisions: mapItems(summary.keyDecisions),
    nextSteps: mapItems(summary.nextSteps),
    highlights: summary.highlights.map((h) => ({ messageId: id(h.messageId) })),
    extractedLists: summary.extractedLists.map((l) => ({ ...l, rows: l.rows.map((r) => ({ ...r, sourceMessageIds: r.sourceMessageIds.map(id) })) })),
  };
}

/** Imports the sample exports through the real importers, then applies the sample summaries. */
export async function loadSampleJournal(): Promise<void> {
  const options = { generateSummaries: false, importImages: true, skipExisting: false, autoTag: true };
  const chatgpt = await createMemoryArchive('sample-chatgpt-export.zip', sampleChatGptExportFiles());
  await runImport({ manifest: chatgpt, importer: importerFor('chatgpt'), options, isSample: true });
  const claude = await createMemoryArchive('sample-claude-export.zip', sampleClaudeExportFiles());
  await runImport({ manifest: claude, importer: importerFor('claude'), options, isSample: true });
  for (const [sourceId, { source, summary }] of Object.entries(SAMPLE_SUMMARIES)) {
    const conversationId = conversationIdFor(source, sourceId);
    await applySummary(entryIdFor(conversationId), mapIds(summary, conversationId), 'Sample data', { autoTag: true });
  }
  notifyChange({ stores: ['entries'], reset: true });
}
