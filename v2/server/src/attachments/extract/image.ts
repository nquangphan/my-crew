import { crc32 } from 'node:zlib';
import { append, type ExtractContext, ExtractError, type ExtractResult, empty, failure } from './index.ts';
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } {
  const b = Buffer.from(bytes);
  if (b.length >= 24 && b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b[0] === 255 && b[1] === 216) {
    let p = 2;
    while (p + 4 <= b.length) {
      if (b[p++] !== 255) throw new ExtractError('CORRUPT_DOCUMENT');
      const marker = b[p++] ?? 0;
      if (marker === 0xd9 || marker === 0xda) break;
      const size = b.readUInt16BE(p);
      if (size < 2 || p + size > b.length) throw new ExtractError('CORRUPT_DOCUMENT');
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (size < 8) throw new ExtractError('CORRUPT_DOCUMENT');
        return { height: b.readUInt16BE(p + 3), width: b.readUInt16BE(p + 5) };
      }
      p += size;
    }
  }
  throw new ExtractError('CORRUPT_DOCUMENT');
}
export async function extractImage(bytes: Uint8Array, c: ExtractContext): Promise<ExtractResult> {
  try {
    c.signal.throwIfAborted();
    const dims = imageDimensions(bytes);
    if (dims.width < 1 || dims.height < 1 || dims.width * dims.height > c.config.limits.maxImagePixels)
      throw new ExtractError('ACTIVE_CONTENT_BLOCKED');
    validateImageStructure(bytes);
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');
    let image: Awaited<ReturnType<typeof loadImage>>;
    try {
      image = await loadImage(Buffer.from(bytes));
    } catch {
      throw new ExtractError('CORRUPT_DOCUMENT');
    }
    if (image.width * image.height > c.config.limits.maxImagePixels)
      throw new ExtractError('ACTIVE_CONTENT_BLOCKED');
    const orientation = exifOrientation(bytes);
    const swapped = orientation >= 5;
    if (
      image.width !== (swapped ? dims.height : dims.width) ||
      image.height !== (swapped ? dims.width : dims.height)
    )
      throw new ExtractError('CORRUPT_DOCUMENT');
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    const r = empty();
    append(
      r,
      {
        kind: 'image',
        width: image.width,
        height: image.height,
        box: [0, 0, 1, 1],
        ...(orientation === 1
          ? {}
          : {
              transform: {
                originalWidth: dims.width,
                originalHeight: dims.height,
                orientation,
                normalizedWidth: image.width,
                normalizedHeight: image.height,
                rotation: [0, 0, 0, 180, 180, 90, 90, 270, 270][orientation] ?? 0,
                reflected: [2, 4, 5, 7].includes(orientation),
              },
            }),
      },
      canvas.toBuffer('image/png'),
      'image',
      c,
    );
    return r;
  } catch (e) {
    return failure(e);
  }
}

function exifOrientation(bytes: Uint8Array): number {
  const b = Buffer.from(bytes);
  if (b[0] !== 255 || b[1] !== 216) return 1;
  for (let p = 2; p + 4 <= b.length; ) {
    if (b[p] !== 255) throw new ExtractError('CORRUPT_DOCUMENT');
    const marker = b[p + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const size = b.readUInt16BE(p + 2);
    if (size < 2 || p + 2 + size > b.length) throw new ExtractError('CORRUPT_DOCUMENT');
    if (marker === 0xe1 && b.subarray(p + 4, p + 10).toString('binary') === 'Exif\0\0') {
      const t = b.subarray(p + 10, p + 2 + size);
      if (t.length < 8) throw new ExtractError('CORRUPT_DOCUMENT');
      const le = t.subarray(0, 2).toString() === 'II';
      if (!le && t.subarray(0, 2).toString() !== 'MM') throw new ExtractError('CORRUPT_DOCUMENT');
      const u16 = (n: number) => (le ? t.readUInt16LE(n) : t.readUInt16BE(n));
      const u32 = (n: number) => (le ? t.readUInt32LE(n) : t.readUInt32BE(n));
      const start = u32(4);
      if (start + 2 > t.length) throw new ExtractError('CORRUPT_DOCUMENT');
      const count = u16(start);
      if (start + 2 + count * 12 > t.length) throw new ExtractError('CORRUPT_DOCUMENT');
      for (let n = 0; n < count; n++) {
        const q = start + 2 + n * 12;
        if (u16(q) === 274) {
          if (u16(q + 2) !== 3 || u32(q + 4) !== 1) throw new ExtractError('CORRUPT_DOCUMENT');
          const value = u16(q + 8);
          if (value < 1 || value > 8) throw new ExtractError('CORRUPT_DOCUMENT');
          return value;
        }
      }
    }
    p += size + 2;
  }
  return 1;
}

function validateImageStructure(bytes: Uint8Array): void {
  const b = Buffer.from(bytes);
  if (b[0] === 137) {
    let p = 8,
      seenData = false,
      seenEnd = false;
    while (p + 12 <= b.length) {
      const size = b.readUInt32BE(p);
      if (size > b.length - p - 12) throw new ExtractError('CORRUPT_DOCUMENT');
      const kind = b.subarray(p + 4, p + 8).toString();
      if (crc32(b.subarray(p + 4, p + 8 + size)) !== b.readUInt32BE(p + 8 + size))
        throw new ExtractError('CORRUPT_DOCUMENT');
      if (kind === 'IDAT') seenData = true;
      if (kind === 'IEND') {
        seenEnd = true;
        if (size !== 0 || p + 12 !== b.length) throw new ExtractError('CORRUPT_DOCUMENT');
      }
      p += 12 + size;
    }
    if (p !== b.length || !seenData || !seenEnd) throw new ExtractError('CORRUPT_DOCUMENT');
  } else if (b.at(-2) !== 255 || b.at(-1) !== 217) throw new ExtractError('CORRUPT_DOCUMENT');
}
