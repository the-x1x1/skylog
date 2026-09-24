import { ImportError, type ArchiveFile, type ArchiveManifest } from './types';
import { ZipError, ZipReader, type ZipEntry } from './zip';

export const LIMITS = {
  /** Largest archive accepted. Entries are read lazily, so this is about sanity, not memory. */
  maxArchiveBytes: 20 * 1024 ** 3,
  /**
   * Largest JSON file parsed in one piece. conversations.json must fit in one JavaScript string,
   * and browsers cap strings at roughly 512 million characters.
   */
  maxJsonBytes: 500 * 1024 ** 2,
  /** Larger images are recorded but not stored. */
  maxImageBytes: 60 * 1024 ** 2,
  sniffBytes: 64 * 1024,
};

const IGNORED = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$)/;

function stripRoot(names: string[]): (name: string) => string {
  // Exports are sometimes re-zipped with an enclosing folder; treat the folder that holds
  // conversations.json as the archive root.
  const candidates = names.filter((n) => n.split('/').pop() === 'conversations.json').sort((a, b) => a.split('/').length - b.split('/').length);
  const first = candidates[0];
  if (!first || !first.includes('/')) return (n) => n;
  const prefix = first.slice(0, first.lastIndexOf('/') + 1);
  return (n) => (n.startsWith(prefix) ? n.slice(prefix.length) : n);
}

async function buildSniffs(files: ArchiveFile[], head: (path: string) => Promise<string>): Promise<Record<string, string>> {
  const sniffs: Record<string, string> = {};
  for (const f of files) {
    if (!f.path.includes('/') && f.path.toLowerCase().endsWith('.json') && f.size > 0) {
      try {
        sniffs[f.path] = await head(f.path);
      } catch {
        /* unreadable entries are reported later when parsed */
      }
    }
  }
  return sniffs;
}

export async function openZipArchive(file: Blob, fileName: string): Promise<ArchiveManifest> {
  if (file.size > LIMITS.maxArchiveBytes) {
    throw new ImportError(`This archive is ${(file.size / 1024 ** 3).toFixed(1)} GB; the limit is ${LIMITS.maxArchiveBytes / 1024 ** 3} GB.`, 'too_large');
  }
  let zip: ZipReader;
  try {
    zip = await ZipReader.open(file);
  } catch (err) {
    if (err instanceof ZipError) throw new ImportError(err.message, 'malformed');
    throw err;
  }
  const usable = zip.entries.filter((e) => !IGNORED.test(e.name));
  const rename = stripRoot(usable.map((e) => e.name));
  const byPath = new Map<string, ZipEntry>();
  for (const e of usable) byPath.set(rename(e.name), e);
  const files: ArchiveFile[] = Array.from(byPath, ([path, e]) => ({ path, size: e.size }));

  const get = (path: string): ZipEntry => {
    const e = byPath.get(path);
    if (!e) throw new ImportError(`${path} is not in the archive.`, 'malformed');
    return e;
  };

  const sniffs = await buildSniffs(files, (p) => zip.head(get(p), LIMITS.sniffBytes));

  return {
    fileName,
    size: file.size,
    files,
    sniffs,
    has: (p) => byPath.has(p),
    async readText(p) {
      const e = get(p);
      if (e.size > LIMITS.maxJsonBytes) {
        throw new ImportError(
          `${p} is ${(e.size / 1024 ** 2).toFixed(0)} MB uncompressed, above the ${LIMITS.maxJsonBytes / 1024 ** 2} MB this browser importer can parse safely.`,
          'too_large',
        );
      }
      try {
        return await zip.text(e);
      } catch (err) {
        throw new ImportError(`Could not read ${p}: ${err instanceof Error ? err.message : String(err)}`, 'malformed');
      }
    },
    async readBlob(p, type = '') {
      try {
        return await zip.blobOf(get(p), type);
      } catch (err) {
        throw new ImportError(`Could not read ${p}: ${err instanceof Error ? err.message : String(err)}`, 'malformed');
      }
    },
  };
}

export type MemoryFileContent = string | Uint8Array | Blob;

/** An in-memory archive, used for the bundled sample journal and in tests. */
export async function createMemoryArchive(fileName: string, contents: Record<string, MemoryFileContent>): Promise<ArchiveManifest> {
  const blobs = new Map<string, Blob>();
  for (const [path, value] of Object.entries(contents)) {
    blobs.set(path, value instanceof Blob ? value : new Blob([value as BlobPart]));
  }
  const rename = stripRoot(Array.from(blobs.keys()));
  const byPath = new Map<string, Blob>();
  for (const [p, b] of blobs) if (!IGNORED.test(p)) byPath.set(rename(p), b);
  const files = Array.from(byPath, ([path, b]) => ({ path, size: b.size }));
  const get = (p: string) => {
    const b = byPath.get(p);
    if (!b) throw new ImportError(`${p} is not in the archive.`, 'malformed');
    return b;
  };
  const sniffs = await buildSniffs(files, async (p) => (await get(p).slice(0, LIMITS.sniffBytes).text()));
  return {
    fileName,
    size: files.reduce((s, f) => s + f.size, 0),
    files,
    sniffs,
    has: (p) => byPath.has(p),
    readText: async (p) => get(p).text(),
    readBlob: async (p, type = '') => {
      const b = get(p);
      return type && b.type !== type ? new Blob([b], { type }) : b;
    },
  };
}

/** Finds a file by exact path, or by basename at the shallowest depth. */
export function findFile(manifest: ArchiveManifest, name: string): string | null {
  if (manifest.has(name)) return name;
  const matches = manifest.files.filter((f) => f.path.split('/').pop() === name).sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  return matches[0]?.path ?? null;
}

export async function readJson(manifest: ArchiveManifest, path: string): Promise<unknown> {
  const text = await manifest.readText(path);
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (err) {
    throw new ImportError(`${path} is not valid JSON (${err instanceof Error ? err.message : String(err)}). The export may be incomplete or corrupted.`, 'malformed');
  }
}
