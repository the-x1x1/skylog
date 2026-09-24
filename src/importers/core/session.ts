import type { ImportBatch, ImportOptions, Source } from '../../data/types';
import { createProvider, makeEntrySummarizer } from '../../summarization/service';
import type { SummaryProviderConfig } from '../../summarization/types';
import { IMPORTERS, importerFor } from '../registry';
import { openZipArchive } from './archive';
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
    const detection = detectSource(this.manifest, IMPORTERS);
    const preview = detection.source ? await importerFor(detection.source).inspect(this.manifest) : null;
    return { detection, preview };
  }

  async preview(source: Source): Promise<ImportPreview> {
    if (!this.manifest) throw new ImportError('Choose an export file first.');
    return importerFor(source).inspect(this.manifest);
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
