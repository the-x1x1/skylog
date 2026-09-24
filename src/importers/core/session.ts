import type { ImportBatch, ImportOptions, Source } from '../../data/types';
import { createProvider, makeEntrySummarizer } from '../../summarization/service';
import type { SummaryProviderConfig } from '../../summarization/types';
import { IMPORTERS, importerFor } from '../registry';
import { getDb } from '../../data/db/database';
import { isBackupArchive } from '../../data/backup';
import { openZipArchive } from './archive';
import { conversationIdFor } from './prepare';
import { detectSource, type DetectionResult } from './detect';
import { runImport } from './pipeline';
import { ImportError, type ArchiveManifest, type ImportPreview, type ImportProgress } from './types';

export interface OpenResult {
  detection: DetectionResult;
  /** Present when the source was detected (or chosen); null when the user must choose. */
  preview: ImportPreview | null;
}

export interface StartArgs {
  source: Source;
  options: ImportOptions;
  summaryConfig: SummaryProviderConfig;
}

/**
 * One import from open → preview → run. Used inside the import worker, and directly on the main
 * thread when workers are unavailable. Holds the opened archive between steps.
 */
export class ImportController {
  private manifest: ArchiveManifest | null = null;
  private abort: AbortController | null = null;

  async open(file: Blob, fileName: string): Promise<OpenResult> {
    if (!/\.zip$/i.test(fileName) && file.type !== 'application/zip' && file.type !== 'application/x-zip-compressed') {
      throw new ImportError(`"${fileName}" is not a .zip file. Export your data from ChatGPT or Claude and choose the .zip you receive.`, 'unsupported');
    }
    this.manifest = await openZipArchive(file, fileName);
    if (isBackupArchive(this.manifest.files)) {
      throw new ImportError(`${fileName} is a journal backup, not a ChatGPT or Claude export. Restore it from Settings → Your data.`, 'unsupported');
    }
    const detection = detectSource(this.manifest, IMPORTERS);
    const preview = detection.source ? await this.inspect(detection.source) : null;
    return { detection, preview };
  }

  async preview(source: Source): Promise<ImportPreview> {
    if (!this.manifest) throw new ImportError('Choose an export file first.');
    return this.inspect(source);
  }

  private async inspect(source: Source): Promise<ImportPreview> {
    const preview = await importerFor(source).inspect(this.manifest!);
    const ids = preview.conversationIds ?? [];
    let already = 0;
    try {
      const db = await getDb();
      already = await db.read('conversations', async (tx) => {
        let n = 0;
        for (let i = 0; i < ids.length; i += 200) {
          const found = await Promise.all(ids.slice(i, i + 200).map((id) => tx.get('conversations', conversationIdFor(source, id))));
          n += found.filter(Boolean).length;
        }
        return n;
      });
    } catch {
      /* the count is informational */
    }
    return { ...preview, conversationIds: undefined, alreadyInJournal: already };
  }

  async run(args: StartArgs, onProgress: (p: ImportProgress) => void): Promise<ImportBatch> {
    if (!this.manifest) throw new ImportError('Choose an export file first.');
    this.abort = new AbortController();
    const provider = args.options.generateSummaries ? createProvider(args.summaryConfig) : null;
    try {
      return await runImport({
        manifest: this.manifest,
        importer: importerFor(args.source),
        options: args.options,
        signal: this.abort.signal,
        onProgress,
        summarizer: provider ? makeEntrySummarizer(provider) : null,
      });
    } finally {
      this.abort = null;
    }
  }

  cancel(): void {
    this.abort?.abort();
  }
}
