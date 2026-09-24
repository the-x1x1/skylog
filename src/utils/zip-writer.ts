/**
 * Minimal ZIP writer (stored or deflated entries) used to build fixture exports and test archives.
 * Dependency-free: uses CompressionStream('deflate-raw') available in Node 20+ and browsers.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export type ZipInput = Record<string, string | Uint8Array>;

export interface ZipEntryInput {
  name: string;
  data: string | Uint8Array;
  /** Default true. Store already-compressed data (images) without deflating. */
  compress?: boolean;
}

export async function createZip(files: ZipInput, opts: { compress?: boolean } = {}): Promise<Uint8Array> {
  const parts = await zipParts(Object.entries(files).map(([name, data]) => ({ name, data, compress: opts.compress ?? true })));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

/** Builds the archive as a Blob without one large contiguous copy (used for journal backups). */
export async function createZipBlob(entries: ZipEntryInput[]): Promise<Blob> {
  return new Blob((await zipParts(entries)) as BlobPart[], { type: 'application/zip' });
}

async function zipParts(entries: ZipEntryInput[]): Promise<Uint8Array[]> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  if (entries.length > 0xffff) throw new Error('Too many files for a ZIP without ZIP64.');

  for (const { name, data, compress = true } of entries) {
    const raw = typeof data === 'string' ? enc.encode(data) : data;
    const nameBytes = enc.encode(name);
    const crc = crc32(raw);
    const body = compress ? await deflateRaw(raw) : raw;
    const method = compress ? 8 : 0;
    if (offset + 30 + nameBytes.length + body.length > 0xffffffff) throw new Error('Archive larger than 4 GB is not supported.');

    const local = new Uint8Array(30 + nameBytes.length + body.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(body, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);
    offset += local.length;
  }

  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  return [...locals, ...centrals, eocd];
}
