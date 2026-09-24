import { notifyChange } from '../db/changes';
import { getDb } from '../db/database';
import type { ImportBatch } from '../types';

export async function saveImportBatch(batch: ImportBatch): Promise<void> {
  const db = await getDb();
  await db.write('imports', (tx) => tx.put('imports', batch));
  notifyChange({ stores: ['imports'] });
}

export async function getImportBatch(id: string): Promise<ImportBatch | null> {
  const db = await getDb();
  return (await db.read('imports', (tx) => tx.get<ImportBatch>('imports', id))) ?? null;
}

export async function listImportBatches(): Promise<ImportBatch[]> {
  const db = await getDb();
  const all = await db.read('imports', (tx) => tx.getAll<ImportBatch>('imports'));
  return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
