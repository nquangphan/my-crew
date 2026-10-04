import {
  append,
  drainFiles,
  type ExtractContext,
  ExtractError,
  type ExtractResult,
  empty,
  failure,
  missing,
} from './index.ts';
import { decodeText } from './text.ts';
export async function extractCsv(bytes: Uint8Array, c: ExtractContext): Promise<ExtractResult> {
  try {
    const { text } = decodeText(bytes);
    const r = empty();
    let state: 'unquoted' | 'quoted' | 'afterQuote' = 'unquoted';
    let row = 1,
      cells: string[] = [],
      field = '',
      fieldBytes = 0,
      total = 0,
      rawBytes = 0;
    let breaks = 0;
    for (const ch of text) if (ch === '\n') breaks++;
    const groupSize = Math.max(1, Math.ceil((breaks + 1) / 8000));
    let batch: string[] = [],
      batchFirst = 1,
      batchColumns = 1;
    const flush = () => {
      if (!batch.length) return true;
      const body = Buffer.from(batch.join(''));
      const ok = append(
        r,
        { kind: 'csv', rowStart: batchFirst, rowEnd: row - 1, columnStart: 1, columnEnd: batchColumns },
        body,
        'text',
        c,
      );
      batch = [];
      batchFirst = row;
      batchColumns = 1;
      return ok;
    };
    const cap = () => {
      flush();
      missing(
        r,
        { kind: 'csv', rowStart: row, rowEnd: row, columnStart: 1, columnEnd: Math.max(cells.length + 1, 1) },
        'text',
        'LIMIT_EXCEEDED',
      );
      return r;
    };
    const finishRow = () => {
      cells.push(field);
      const body = `${JSON.stringify({ row, cells: cells.map((value, i) => ({ column: i + 1, value })) })}\n`;
      total += Buffer.byteLength(body);
      if (total > c.config.limits.maxTextBytes) return false;
      batch.push(body);
      batchColumns = Math.max(batchColumns, cells.length);
      row++;
      cells = [];
      field = '';
      fieldBytes = 0;
      state = 'unquoted';
      return batch.length >= groupSize ? flush() : true;
    };
    for (let i = 0; i < text.length; i++) {
      c.signal.throwIfAborted();
      const ch = String.fromCodePoint(text.codePointAt(i) ?? 0);
      if (ch.length === 2) i++;
      rawBytes += Buffer.byteLength(ch);
      if (rawBytes > c.config.limits.maxTextBytes || row > c.config.limits.maxCsvRows) return cap();
      if (state === 'quoted') {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            fieldBytes++;
            i++;
          } else state = 'afterQuote';
        } else {
          field += ch;
          fieldBytes += Buffer.byteLength(ch);
        }
      } else if (ch === ',') {
        cells.push(field);
        field = '';
        fieldBytes = 0;
        state = 'unquoted';
        if (cells.length >= c.config.limits.maxCsvColumns) return cap();
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        if (!finishRow()) return cap();
        if (batch.length === 0) await drainFiles(r, c);
      } else if (ch === '"' && state === 'unquoted' && field === '') state = 'quoted';
      else if (ch === '"' || state === 'afterQuote') throw new ExtractError('CORRUPT_DOCUMENT');
      else {
        field += ch;
        fieldBytes += Buffer.byteLength(ch);
      }
      if (fieldBytes > c.config.limits.maxCsvFieldBytes) return cap();
    }
    if (state === 'quoted') throw new ExtractError('CORRUPT_DOCUMENT');
    if (field || cells.length || state === 'afterQuote' || (row === 1 && !batch.length)) {
      if (!finishRow()) return cap();
    }
    flush();
    await drainFiles(r, c);
    return r;
  } catch (e) {
    return failure(e);
  }
}
