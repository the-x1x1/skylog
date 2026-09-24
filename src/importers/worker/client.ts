import type { ImportBatch, Source } from '../../data/types';
import { spawnWorker, WORKERS } from '../../utils/workers';
import { ImportController, type OpenResult, type StartArgs } from '../core/session';
import { ImportError, type ImportPreview, type ImportProgress } from '../core/types';
import type { ImportRequest, ImportResponse } from './protocol';

export interface ImportSession {
  readonly usesWorker: boolean;
  open(file: File): Promise<OpenResult>;
  preview(source: Source): Promise<ImportPreview>;
  start(args: StartArgs, onProgress: (p: ImportProgress) => void): Promise<ImportBatch>;
  cancel(): void;
  dispose(): void;
}

class WorkerSession implements ImportSession {
  readonly usesWorker = true;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (p: ImportProgress) => void }>();

  constructor(private readonly worker: Worker) {
    worker.onmessage = (e: MessageEvent<ImportResponse>) => {
      const msg = e.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      switch (msg.type) {
        case 'progress':
          p.onProgress?.(msg.progress);
          return;
        case 'opened':
          p.resolve(msg.result);
          break;
        case 'previewed':
          p.resolve(msg.preview);
          break;
        case 'finished':
          p.resolve(msg.batch);
          break;
        case 'error':
          p.reject(new ImportError(msg.message, msg.code as ImportError['code']));
          break;
      }
      this.pending.delete(msg.id);
    };
    worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'The import worker crashed.'));
      this.pending.clear();
    };
  }

  private request<T>(build: (id: number) => ImportRequest, onProgress?: (p: ImportProgress) => void): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
      this.worker.postMessage(build(id));
    });
  }

  open(file: File) {
    return this.request<OpenResult>((id) => ({ type: 'open', id, file, fileName: file.name }));
  }
  preview(source: Source) {
    return this.request<ImportPreview>((id) => ({ type: 'preview', id, source }));
  }
  start(args: StartArgs, onProgress: (p: ImportProgress) => void) {
    return this.request<ImportBatch>((id) => ({ type: 'start', id, args }), onProgress);
  }
  cancel() {
    this.worker.postMessage({ type: 'cancel' } satisfies ImportRequest);
  }
  dispose() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('Import closed.'));
    this.pending.clear();
  }
}

class InlineSession implements ImportSession {
  readonly usesWorker = false;
  private controller = new ImportController();
  open(file: File) {
    return this.controller.open(file, file.name);
  }
  preview(source: Source) {
    return this.controller.preview(source);
  }
  start(args: StartArgs, onProgress: (p: ImportProgress) => void) {
    return this.controller.run(args, onProgress);
  }
  cancel() {
    this.controller.cancel();
  }
  dispose() {
    this.controller.cancel();
  }
}

export function createImportSession(): ImportSession {
  const worker = spawnWorker(WORKERS.import, 'import');
  return worker ? new WorkerSession(worker) : new InlineSession();
}
