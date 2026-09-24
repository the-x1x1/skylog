import { BRAND } from '../config/brand';
import { openZipArchive, readJson } from '../importers/core/archive';
import { ImportError } from '../importers/core/types';
import { createZipBlob, type ZipEntryInput } from '../utils/zip-writer';
import { notifyChange } from './db/changes';
import { getDb } from './db/database';
import { SCHEMA_VERSION } from './migrations';
import type { BlobRecord } from './types';

/**
 * Whole-journal backup: every store as JSON plus image files, in one .zip. Browsers can clear
 * site data (storage pressure, "clear browsing data"), so this is the user's safety net.
 */

export const BACKUP_FORMAT = 'conversation-journal-backup';
const RECORD_STORES = ['conversations', 'messages', 'images', 'entries', 'edits', 'collections', 'imports', 'settings'] as const;

interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: 1;
  schemaVersion: number;
  exportedAt: string;
  exportedBy: string;
  counts: Record<string, number>;
  stores: Record<(typeof RECORD_STORES)[number], unknown[]>;
  blobs: { key: string; path: string; mimeType: string; size: number }[];
}

export interface BackupSummary {
  entries: number;
  messages: number;
  images: number;
  bytes: number;
}

const COMPRESSED_TYPES = /^(image\/(png|jpe?g|webp|gif|avif|heic|heif)|application\/zip)$/i;

export async function createBackup(onProgress?: (done: number, total: number) => void): Promise<{ blob: Blob; summary: BackupSummary }> {
  const db = await getDb();
  const stores = {} as BackupManifest['stores'];
  for (const s of RECORD_STORES) stores[s] = await db.read(s, (tx) => tx.getAll(s));
  const blobKeys = (await db.read('blobs', (tx) => tx.getAllKeys('blobs'))).map(String);

  const entries: ZipEntryInput[] = [];
  const blobs: BackupManifest['blobs'] = [];
  for (let i = 0; i < blobKeys.length; i++) {
    const key = blobKeys[i]!;
    const rec = await db.read('blobs', (tx) => tx.get<BlobRecord>('blobs', key));
    if (!rec) continue;
    const path = `blobs/${String(i).padStart(6, '0')}`;
    const data = new Uint8Array(await rec.blob.arrayBuffer());
    entries.push({ name: path, data, compress: !COMPRESSED_TYPES.test(rec.mimeType) });
    blobs.push({ key, path, mimeType: rec.mimeType, size: rec.size });
    onProgress?.(i + 1, blobKeys.length);
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: 1,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: `${BRAND.name} ${BRAND.version}`,
    counts: Object.fromEntries(RECORD_STORES.map((s) => [s, stores[s].length])),
    stores,
    blobs,
  };
  entries.unshift({ name: 'backup.json', data: JSON.stringify(manifest) });
  const blob = await createZipBlob(entries);
  return { blob, summary: { entries: stores.entries.length, messages: stores.messages.length, images: blobs.length, bytes: blob.size } };
}

export function backupFileName(now = new Date()): string {
  return `journal-backup-${now.toISOString().slice(0, 10)}.zip`;
}

/** Returns true if the archive looks like one of our backups (used to guide users on import). */
export function isBackupArchive(files: { path: string }[]): boolean {
  return files.some((f) => f.path === 'backup.json');
}

/**
 * Restores a backup by merging it into the current journal: records with the same id are
 * replaced by the backup's copy; nothing else is deleted.
 */
export async function restoreBackup(file: Blob, fileName: string, onProgress?: (done: number, total: number) => void): Promise<BackupSummary> {
  const archive = await openZipArchive(file, fileName);
  if (!archive.has('backup.json')) throw new ImportError(`${fileName} is not a journal backup (no backup.json).`, 'unsupported');
  const manifest = (await readJson(archive, 'backup.json')) as Partial<BackupManifest>;
  if (manifest.format !== BACKUP_FORMAT || manifest.formatVersion !== 1 || !manifest.stores) {
    throw new ImportError(`${fileName} is not a backup this version can read.`, 'unsupported');
  }
  if ((manifest.schemaVersion ?? 0) > SCHEMA_VERSION) {
    throw new ImportError('This backup was made by a newer version of the app. Update the app, then restore it.', 'unsupported');
  }
  const db = await getDb();
  const blobList = manifest.blobs ?? [];
  const total = RECORD_STORES.reduce((n, s) => n + (manifest.stores?.[s]?.length ?? 0), 0) + blobList.length;
  let done = 0;
  for (const s of RECORD_STORES) {
    const records = manifest.stores[s] ?? [];
    for (let i = 0; i < records.length; i += 500) {
      const chunk = records.slice(i, i + 500);
      await db.write(s, (tx) => tx.putAll(s, chunk), { durability: 'relaxed' });
      done += chunk.length;
      onProgress?.(done, total);
    }
  }
  let bytes = 0;
  for (const b of blobList) {
    const blob = await archive.readBlob(b.path, b.mimeType);
    bytes += blob.size;
    await db.write('blobs', (tx) => tx.put('blobs', { key: b.key, blob, mimeType: b.mimeType, size: blob.size } satisfies BlobRecord), { durability: 'relaxed' });
    onProgress?.(++done, total);
  }
  notifyChange({ stores: [...RECORD_STORES, 'blobs'], reset: true });
  return { entries: manifest.stores.entries?.length ?? 0, messages: manifest.stores.messages?.length ?? 0, images: blobList.length, bytes };
}
