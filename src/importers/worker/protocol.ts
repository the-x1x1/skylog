import type { ImportBatch, Source } from '../../data/types';
import type { OpenResult, StartArgs } from '../core/session';
import type { ImportPreview, ImportProgress } from '../core/types';

export type ImportRequest =
  | { type: 'open'; id: number; file: Blob; fileName: string }
  | { type: 'preview'; id: number; source: Source }
  | { type: 'start'; id: number; args: StartArgs }
  | { type: 'cancel' };

export type ImportResponse =
  | { type: 'opened'; id: number; result: OpenResult }
  | { type: 'previewed'; id: number; preview: ImportPreview }
  | { type: 'progress'; id: number; progress: ImportProgress }
  | { type: 'finished'; id: number; batch: ImportBatch }
  | { type: 'error'; id: number; message: string; code: string };
