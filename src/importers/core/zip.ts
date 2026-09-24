/**
 * Minimal random-access ZIP reader over a Blob/File. It reads only the central directory up
 * front and decompresses individual entries on demand through the platform's
 * DecompressionStream, so multi-gigabyte exports never have to be loaded into memory at once.
 * Supports stored and deflated entries, UTF-8 names, and ZIP64.
 */

export class ZipError extends Error {}

export interface ZipEntry {
  name: string;
  compressedSize: number;
  size: number;
  method: number;
  encrypted: boolean;
  localHeaderOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const utf8 = new TextDecoder('utf-8');

async function readBytes(blob: Blob, start: number, end: number): Promise<DataView> {
  const buf = await blob.slice(start, end).arrayBuffer();
  return new DataView(buf);
}

function u64(view: DataView, offset: number): number {
  const lo = view.getUint32(offset, true);
  const hi = view.getUint32(offset + 4, true);
  return hi * 0x100000000 + lo;
}

export interface ZipLimits {
  maxEntries: number;
}

export class ZipReader {
  private constructor(
    readonly blob: Blob,
    readonly entries: ZipEntry[],
  ) {}

  static async open(blob: Blob, limits: ZipLimits = { maxEntries: 500_000 }): Promise<ZipReader> {
    if (blob.size < 22) throw new ZipError('This file is too small to be a .zip archive.');
    const tailLen = Math.min(blob.size, 22 + 0xffff + 20);
    const tailStart = blob.size - tailLen;
    const tail = await readBytes(blob, tailStart, blob.size);

    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === SIG_EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ZipError('This file is not a valid .zip archive (no central directory found).');

    let entryCount = tail.getUint16(eocd + 10, true);
    let cdSize = tail.getUint32(eocd + 12, true);
    let cdOffset = tail.getUint32(eocd + 16, true);

    const needsZip64 = entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff;
    if (needsZip64 && eocd >= 20 && tail.getUint32(eocd - 20, true) === SIG_ZIP64_LOCATOR) {
      const z64Offset = u64(tail, eocd - 20 + 8);
      const z64 = await readBytes(blob, z64Offset, z64Offset + 56);
      if (z64.getUint32(0, true) !== SIG_ZIP64_EOCD) throw new ZipError('Corrupt ZIP64 directory.');
      entryCount = u64(z64, 32);
      cdSize = u64(z64, 40);
      cdOffset = u64(z64, 48);
    }
    if (entryCount > limits.maxEntries) {
      throw new ZipError(`This archive has ${entryCount.toLocaleString()} files, more than the ${limits.maxEntries.toLocaleString()} supported.`);
    }
    if (cdOffset + cdSize > blob.size) throw new ZipError('The archive is truncated (central directory is past the end of the file).');

    const cd = await readBytes(blob, cdOffset, cdOffset + cdSize);
    const entries: ZipEntry[] = [];
    let p = 0;
    for (let i = 0; i < entryCount; i++) {
      if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== SIG_CENTRAL) {
        throw new ZipError('The archive directory is corrupt.');
      }
      const flags = cd.getUint16(p + 8, true);
      const method = cd.getUint16(p + 10, true);
      let compressedSize = cd.getUint32(p + 20, true);
      let size = cd.getUint32(p + 24, true);
      const nameLen = cd.getUint16(p + 28, true);
      const extraLen = cd.getUint16(p + 30, true);
      const commentLen = cd.getUint16(p + 32, true);
      let localHeaderOffset = cd.getUint32(p + 42, true);
      const nameBytes = new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen);
      const name = utf8.decode(nameBytes);

      // ZIP64 extended information extra field.
      let e = p + 46 + nameLen;
      const extraEnd = e + extraLen;
      while (e + 4 <= extraEnd) {
        const id = cd.getUint16(e, true);
        const len = cd.getUint16(e + 2, true);
        if (id === 0x0001) {
          let q = e + 4;
          if (size === 0xffffffff && q + 8 <= e + 4 + len) {
            size = u64(cd, q);
            q += 8;
          }
          if (compressedSize === 0xffffffff && q + 8 <= e + 4 + len) {
            compressedSize = u64(cd, q);
            q += 8;
          }
          if (localHeaderOffset === 0xffffffff && q + 8 <= e + 4 + len) {
            localHeaderOffset = u64(cd, q);
          }
        }
        e += 4 + len;
      }

      if (!name.endsWith('/')) {
        entries.push({ name, compressedSize, size, method, encrypted: (flags & 1) === 1, localHeaderOffset });
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    return new ZipReader(blob, entries);
  }

  private async dataRange(entry: ZipEntry): Promise<[number, number]> {
    const header = await readBytes(this.blob, entry.localHeaderOffset, entry.localHeaderOffset + 30);
    if (header.getUint32(0, true) !== SIG_LOCAL) throw new ZipError(`Corrupt entry header for ${entry.name}.`);
    const start = entry.localHeaderOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
    return [start, start + entry.compressedSize];
  }

  /** Returns a stream of the entry's decompressed bytes. */
  async stream(entry: ZipEntry): Promise<ReadableStream<Uint8Array>> {
    if (entry.encrypted) throw new ZipError(`${entry.name} is encrypted; password-protected archives are not supported.`);
    const [start, end] = await this.dataRange(entry);
    if (end > this.blob.size) throw new ZipError(`${entry.name} is truncated.`);
    const raw = this.blob.slice(start, end).stream() as ReadableStream<Uint8Array>;
    if (entry.method === 0) return raw;
    if (entry.method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new ZipError('This browser cannot decompress ZIP files (DecompressionStream missing).');
      return raw.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
    }
    throw new ZipError(`${entry.name} uses an unsupported compression method (${entry.method}).`);
  }

  async blobOf(entry: ZipEntry, type = ''): Promise<Blob> {
    if (entry.method === 0 && !entry.encrypted) {
      const [start, end] = await this.dataRange(entry);
      return this.blob.slice(start, end, type);
    }
    const res = new Response(await this.stream(entry));
    const data = await res.arrayBuffer();
    return new Blob([data], { type });
  }

  async text(entry: ZipEntry): Promise<string> {
    const res = new Response(await this.stream(entry));
    return res.text();
  }

  /** Decompresses only the first `maxBytes` of an entry (used to sniff file contents cheaply). */
  async head(entry: ZipEntry, maxBytes: number): Promise<string> {
    const reader = (await this.stream(entry)).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (total < maxBytes) {
        const { value, done } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        total += value.byteLength;
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }
    const merged = new Uint8Array(Math.min(total, maxBytes));
    let off = 0;
    for (const c of chunks) {
      const take = Math.min(c.byteLength, merged.byteLength - off);
      merged.set(c.subarray(0, take), off);
      off += take;
      if (off >= merged.byteLength) break;
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(merged);
  }
}
