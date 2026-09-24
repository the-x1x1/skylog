import { IDBFactory } from 'fake-indexeddb';
import { closeDb, useIndexedDbFactory } from '../../src/data/db/database';
import { createMemoryArchive } from '../../src/importers/core/archive';
import { openZipArchive } from '../../src/importers/core/archive';
import { createZip, type ZipInput } from '../../scripts/lib/zip-writer';

/** Points the app's database at a brand-new in-memory IndexedDB. Call in beforeEach. */
export async function freshDb(): Promise<IDBFactory> {
  await closeDb();
  const factory = new IDBFactory();
  useIndexedDbFactory(factory);
  return factory;
}

export async function zipArchive(name: string, files: ZipInput) {
  const bytes = await createZip(files);
  return openZipArchive(new Blob([bytes as BlobPart], { type: 'application/zip' }), name);
}

export { createMemoryArchive };
