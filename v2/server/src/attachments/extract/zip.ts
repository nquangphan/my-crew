import { crc32 } from 'node:zlib';
import type { Entry, ZipFile } from 'yauzl';
import { type ExtractContext, ExtractError } from './index.ts';
export function canonicalPart(name: string): string {
  if (
    name !== name.normalize('NFC') ||
    name.includes('\\') ||
    [...name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === '%' || c === ':') ||
    name.startsWith('/') ||
    name.split('/').some((p) => p === '.' || p === '..' || p === '')
  )
    throw new ExtractError('CORRUPT_DOCUMENT');
  return name.toLowerCase();
}
export async function readOfficeParts(
  bytes: Uint8Array,
  c: ExtractContext,
): Promise<Map<string, Uint8Array>> {
  const b = Buffer.from(bytes);
  const bad = () => {
    throw new ExtractError('CORRUPT_DOCUMENT');
  };
  const limit = () => {
    throw new ExtractError('LIMIT_EXCEEDED');
  };
  const expected = new Map<string, { crc: number; size: number; offset: number }>();
  try {
    let end = -1;
    for (let p = b.length - 22; p >= Math.max(0, b.length - 65557); p--)
      if (b.readUInt32LE(p) === 0x06054b50 && p + 22 + b.readUInt16LE(p + 20) === b.length) {
        end = p;
        break;
      }
    if (end < 0) return bad();
    if (b.readUInt16LE(end + 4) || b.readUInt16LE(end + 6)) return bad();
    const n = b.readUInt16LE(end + 10);
    if (n !== b.readUInt16LE(end + 8) || n === 65535) return bad();
    if (n > c.config.limits.maxZipEntries) return limit();
    const size = b.readUInt32LE(end + 12),
      start = b.readUInt32LE(end + 16);
    if (start + size !== end) return bad();
    let p = start;
    let declared = 0;
    const normalized = new Set<string>();
    const spans: { start: number; end: number }[] = [];
    for (let i = 0; i < n; i++) {
      if (p + 46 > end || b.readUInt32LE(p) !== 0x02014b50) return bad();
      const flags = b.readUInt16LE(p + 8),
        method = b.readUInt16LE(p + 10),
        crc = b.readUInt32LE(p + 16),
        compressed = b.readUInt32LE(p + 20),
        expanded = b.readUInt32LE(p + 24),
        nl = b.readUInt16LE(p + 28),
        xl = b.readUInt16LE(p + 30),
        cl = b.readUInt16LE(p + 32),
        attrs = b.readUInt32LE(p + 38),
        offset = b.readUInt32LE(p + 42);
      if (p + 46 + nl + xl + cl > end || [expanded, compressed, offset].includes(0xffffffff)) return bad();
      const name = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(p + 46, p + 46 + nl));
      const key = canonicalPart(name);
      if (normalized.has(key)) return bad();
      normalized.add(key);
      if (flags & 0x41) throw new ExtractError('ACTIVE_CONTENT_BLOCKED');
      if (flags & ~0x808 || ![0, 8].includes(method)) return bad();
      const mode = (attrs >>> 16) & 0xf000;
      if (mode !== 0 && mode !== 0x8000) return bad();
      if (
        expanded > c.config.limits.maxEntryBytes ||
        expanded / (compressed || 1) > c.config.limits.maxCompressionRatio ||
        (compressed === 0 && expanded > 0)
      )
        return limit();
      declared += expanded;
      if (declared > c.config.limits.maxExpandedBytes) return limit();
      if (offset + 30 > start || b.readUInt32LE(offset) !== 0x04034b50) return bad();
      const lnl = b.readUInt16LE(offset + 26),
        lxl = b.readUInt16LE(offset + 28);
      const dataStart = offset + 30 + lnl + lxl;
      let dataEnd = dataStart + compressed;
      if (
        b.readUInt16LE(offset + 6) !== flags ||
        b.readUInt16LE(offset + 8) !== method ||
        !b.subarray(offset + 30, offset + 30 + lnl).equals(b.subarray(p + 46, p + 46 + nl))
      )
        return bad();
      if (!(flags & 8)) {
        if (
          b.readUInt32LE(offset + 14) !== crc ||
          b.readUInt32LE(offset + 18) !== compressed ||
          b.readUInt32LE(offset + 22) !== expanded
        )
          return bad();
      } else {
        if (dataEnd + 12 > start) return bad();
        const descriptor = dataEnd + (b.readUInt32LE(dataEnd) === 0x08074b50 ? 4 : 0);
        if (
          descriptor + 12 > start ||
          b.readUInt32LE(descriptor) !== crc ||
          b.readUInt32LE(descriptor + 4) !== compressed ||
          b.readUInt32LE(descriptor + 8) !== expanded
        )
          return bad();
        dataEnd = descriptor + 12;
      }
      if (dataEnd > start) return bad();
      spans.push({ start: offset, end: dataEnd });
      expected.set(name, { crc, size: expanded, offset });
      p += 46 + nl + xl + cl;
    }
    if (p !== end) return bad();
    spans.sort((a, d) => a.start - d.start);
    for (let i = 1; i < spans.length; i++)
      if ((spans[i]?.start ?? 0) < (spans[i - 1]?.end ?? 0)) return bad();
  } catch (e) {
    if (e instanceof ExtractError) throw e;
    return bad();
  }
  const { fromBuffer } = await import('yauzl');
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    fromBuffer(
      b,
      { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true },
      (e, z) => (e ? reject(new ExtractError('CORRUPT_DOCUMENT')) : resolve(z)),
    ),
  );
  const parts = new Map<string, Uint8Array>();
  let total = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      let failed = false;
      const fail = (error: unknown) => {
        if (failed) return;
        failed = true;
        zip.close();
        reject(error instanceof ExtractError ? error : new ExtractError('CORRUPT_DOCUMENT'));
      };
      const abort = () => fail(new ExtractError('EXTRACTOR_FAILED'));
      c.signal.addEventListener('abort', abort, { once: true });
      zip.on('error', fail);
      zip.on('end', () => {
        c.signal.removeEventListener('abort', abort);
        if (parts.size !== expected.size) fail(new ExtractError('CORRUPT_DOCUMENT'));
        else resolve();
      });
      zip.on('entry', (entry: Entry) => {
        if (failed) return;
        const record = expected.get(entry.fileName);
        if (
          !record ||
          record.crc !== entry.crc32 ||
          record.size !== entry.uncompressedSize ||
          record.offset !== entry.relativeOffsetOfLocalHeader
        ) {
          fail(new ExtractError('CORRUPT_DOCUMENT'));
          return;
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error) {
            fail(error);
            return;
          }
          (async () => {
            const chunks: Buffer[] = [];
            let size = 0,
              crc = 0;
            for await (const chunk of stream) {
              c.signal.throwIfAborted();
              const body = Buffer.from(chunk);
              size += body.length;
              total += body.length;
              if (
                size > c.config.limits.maxEntryBytes ||
                total > c.config.limits.maxExpandedBytes ||
                size > record.size ||
                size / (entry.compressedSize || 1) > c.config.limits.maxCompressionRatio
              )
                throw new ExtractError('LIMIT_EXCEEDED');
              crc = crc32(body, crc);
              chunks.push(body);
            }
            if (size !== record.size || crc !== record.crc) throw new ExtractError('CORRUPT_DOCUMENT');
            parts.set(entry.fileName, Buffer.concat(chunks, size));
            zip.readEntry();
          })().catch(fail);
        });
      });
      if (c.signal.aborted) abort();
      else zip.readEntry();
    });
    return parts;
  } finally {
    zip.close();
  }
}
