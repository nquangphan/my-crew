// Port từ v2/server/src/attachments/extract/text.ts (a13dd7d).
import {
  append,
  type ExtractContext,
  ExtractError,
  type ExtractResult,
  empty,
  failure,
  missing,
} from './index.js';
export function decodeText(bytes: Uint8Array): {
  text: string;
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be';
  bom: number;
} {
  let encoding: 'utf-8' | 'utf-16le' | 'utf-16be' = 'utf-8';
  let bom = 0;
  if (bytes[0] === 255 && bytes[1] === 254) {
    encoding = 'utf-16le';
    bom = 2;
  } else if (bytes[0] === 254 && bytes[1] === 255) {
    encoding = 'utf-16be';
    bom = 2;
  } else if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) bom = 3;
  try {
    return {
      text: new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes.subarray(bom)),
      encoding,
      bom,
    };
  } catch {
    throw new ExtractError('UNSUPPORTED_ENCODING');
  }
}
export function escapeText(text: string): string {
  return [...text]
    .map((c) => {
      const n = c.charCodeAt(0);
      return (n < 32 && ![9, 10, 13].includes(n)) || n === 127 ? `\\u${n.toString(16).padStart(4, '0')}` : c;
    })
    .join('');
}
export async function extractText(bytes: Uint8Array, c: ExtractContext): Promise<ExtractResult> {
  try {
    const d = decodeText(bytes);
    const r = empty();
    let offset = d.bom,
      start = 0,
      line = 1,
      startLine = 1,
      body = '',
      emitted = 0,
      bodyBytes = 0;
    let finalLine = 1;
    for (const ch of d.text) if (ch === '\n') finalLine++;
    const flush = () => {
      const ok = append(
        r,
        { kind: 'text', byteStart: start, byteEnd: offset, lineStart: startLine, lineEnd: line },
        Buffer.from(body),
        'text',
        c,
      );
      body = '';
      bodyBytes = 0;
      start = offset;
      startLine = line;
      return ok;
    };
    for (const ch of d.text) {
      const size = d.encoding === 'utf-8' ? Buffer.byteLength(ch) : ch.length * 2;
      const escaped = escapeText(ch);
      const out = Buffer.byteLength(escaped);
      if (emitted + out > c.config.limits.maxTextBytes) {
        if (body) flush();
        missing(
          r,
          { kind: 'text', byteStart: offset, byteEnd: bytes.length, lineStart: line, lineEnd: finalLine },
          'text',
          'LIMIT_EXCEEDED',
        );
        return r;
      }
      if (bodyBytes + out > 32768 && !flush()) {
        missing(
          r,
          { kind: 'text', byteStart: offset, byteEnd: bytes.length, lineStart: line, lineEnd: finalLine },
          'text',
          'LIMIT_EXCEEDED',
        );
        return r;
      }
      body += escaped;
      bodyBytes += out;
      offset += size;
      emitted += out;
      if (ch === '\n') line++;
    }
    if (body || !r.units.length) flush();
    return r;
  } catch (e) {
    return failure(e);
  }
}
