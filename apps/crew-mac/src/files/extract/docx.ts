// Port từ v2/server/src/attachments/extract/docx.ts (a13dd7d).
import { posix } from 'node:path';
import {
  append,
  drainFiles,
  type ExtractContext,
  ExtractError,
  type ExtractResult,
  empty,
  failure,
  missing,
} from './index.js';
import type { SourceLocator } from './limits.js';
import { parseXml, type XmlEvent } from './xml.js';
import { canonicalPart, readOfficeParts } from './zip.js';
export const wordNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const sheetNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const relationshipNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const officeRelNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export type Relationship = { id: string; type: string; target: string; external: boolean };
export function events(bytes: Uint8Array, c: ExtractContext): XmlEvent[] {
  const out: XmlEvent[] = [];
  parseXml(
    bytes,
    (e) => {
      if (out.length >= 200000) throw new ExtractError('LIMIT_EXCEEDED');
      out.push(e);
    },
    c.config,
  );
  return out;
}
export function relationships(
  parts: Map<string, Uint8Array>,
  part: string,
  c: ExtractContext,
): Relationship[] {
  const path = part ? `${posix.dirname(part)}/_rels/${posix.basename(part)}.rels` : '_rels/.rels';
  const bytes = parts.get(path);
  if (!bytes) return [];
  const result: Relationship[] = [];
  const ids = new Set<string>();
  for (const e of events(bytes, c)) {
    if (e.kind !== 'open' || e.local !== 'Relationship' || e.uri !== relationshipNs) continue;
    const id = e.attributes.Id ?? '',
      type = e.attributes.Type ?? '',
      raw = e.attributes.Target ?? '',
      external = e.attributes.TargetMode === 'External';
    if (!id || ids.has(id) || !raw) throw new ExtractError('CORRUPT_DOCUMENT');
    ids.add(id);
    const target = external ? raw : posix.normalize(posix.join(posix.dirname(part || '.'), raw));
    if (!external) canonicalPart(target);
    result.push({ id, type, target, external });
  }
  return result;
}
export function validateOffice(
  parts: Map<string, Uint8Array>,
  kind: 'docx' | 'xlsx',
  c: ExtractContext,
): string {
  const content = parts.get('[Content_Types].xml');
  if (!content || !parts.has('_rels/.rels')) throw new ExtractError('CORRUPT_DOCUMENT');
  for (const [name, bytes] of parts) {
    if (/vbaProject|\/embeddings\/|\.exe$|\.dll$|\.com$/i.test(name))
      throw new ExtractError('ACTIVE_CONTENT_BLOCKED');
    if (name.endsWith('.xml') || name.endsWith('.rels'))
      for (const e of events(bytes, c)) {
        if (
          e.kind === 'open' &&
          (e.local === 'object' ||
            e.local === 'OLEObject' ||
            Object.values(e.attributes).some((v) => /macroEnabled|vbaProject|oleObject|activeX/i.test(v)))
        )
          throw new ExtractError('ACTIVE_CONTENT_BLOCKED');
      }
  }
  const roots = relationships(parts, '', c).filter((r) => r.type === `${officeRelNs}/officeDocument`);
  if (roots.length !== 1 || roots[0]?.external) throw new ExtractError('CORRUPT_DOCUMENT');
  const main = roots[0]?.target ?? '';
  const expected = kind === 'docx' ? 'wordprocessingml.document.main+xml' : 'spreadsheetml.sheet.main+xml';
  if (
    !events(content, c).some(
      (e) =>
        e.kind === 'open' &&
        e.attributes.PartName === `/${main}` &&
        e.attributes.ContentType?.endsWith(expected),
    ) ||
    !parts.has(main)
  )
    throw new ExtractError('UNSUPPORTED_TYPE');
  const mainBytes = parts.get(main);
  if (!mainBytes) throw new ExtractError('CORRUPT_DOCUMENT');
  const root = events(mainBytes, c).find((e) => e.kind === 'open');
  if (
    !root ||
    root.uri !== (kind === 'docx' ? wordNs : sheetNs) ||
    root.local !== (kind === 'docx' ? 'document' : 'workbook')
  )
    throw new ExtractError('UNSUPPORTED_TYPE');
  return main;
}
/** Đuôi theo chữ ký byte của ảnh nhúng mà `Read` đọc được; kiểu khác (EMF, WMF, TIFF…) bị bỏ qua. */
export function mediaExtension(bytes: Uint8Array): 'png' | 'jpg' | 'gif' | 'webp' | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.toString('latin1', 0, 6))) return 'gif';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP')
    return 'webp';
  return null;
}
/** v2 vẽ lại ảnh bằng canvas; ở Mac ảnh nhúng được ghi nguyên byte nếu là PNG/JPEG/GIF/WebP. */
export async function appendOfficeImage(
  r: ExtractResult,
  bytes: Uint8Array | undefined,
  locator: SourceLocator,
  c: ExtractContext,
): Promise<void> {
  if (!bytes) {
    missing(r, locator, 'vision', 'EXTERNAL_RESOURCE_UNAVAILABLE');
    return;
  }
  const ext = mediaExtension(bytes);
  if (ext) append(r, locator, bytes, 'image', c, ext);
  else missing(r, locator, 'vision', 'UNSUPPORTED_VISUAL');
}
export async function extractDocx(bytes: Uint8Array, c: ExtractContext): Promise<ExtractResult> {
  try {
    const parts = await readOfficeParts(bytes, c);
    const main = validateOffice(parts, 'docx', c);
    const r = empty();
    const list = [
      main,
      ...[...parts.keys()]
        .filter((n) => n !== main && /^word\/(header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(n))
        .sort(),
    ];
    for (const part of list) {
      const data = parts.get(part);
      if (!data) throw new ExtractError('CORRUPT_DOCUMENT');
      const root = events(data, c).find((e) => e.kind === 'open');
      const expected =
        part === main
          ? 'document'
          : /\/header\d*\.xml$/.test(part)
            ? 'hdr'
            : /\/footer\d*\.xml$/.test(part)
              ? 'ftr'
              : posix.basename(part, '.xml');
      if (root?.uri !== wordNs || root.local !== expected) throw new ExtractError('UNSUPPORTED_TYPE');
    }
    for (const part of list) {
      const data = parts.get(part);
      if (!data) throw new ExtractError('CORRUPT_DOCUMENT');
      const rels = relationships(parts, part, c);
      let paragraph = 0,
        table: number | null = null,
        row: number | null = null,
        cell: number | null = null,
        tableCount = 0;
      let buffer = '';
      let inText = false;
      let inParagraph = false;
      let visual = 0;
      let drawingImageStart = 0;
      const tableStack: { table: number | null; row: number | null; cell: number | null }[] = [];
      const locator = () => ({ kind: 'docx' as const, part, paragraph, table, row, cell });
      const pending: { ref: string; locator: SourceLocator }[] = [];
      const anchoredRelations = new Set<string>();
      for (const e of events(data, c)) {
        if (e.kind === 'open' && e.uri === wordNs) {
          if (e.local === 'drawing') drawingImageStart = pending.length;
          if (e.local === 'tbl') {
            tableStack.push({ table, row, cell });
            table = ++tableCount;
            row = 0;
            cell = 0;
          }
          if (e.local === 'tr') {
            row = (row ?? 0) + 1;
            cell = 0;
          }
          if (e.local === 'tc') cell = (cell ?? 0) + 1;
          if (e.local === 'p') {
            if (inParagraph) throw new ExtractError('UNSUPPORTED_TYPE');
            paragraph++;
            buffer = '';
            inParagraph = true;
            visual = 0;
          }
          if (e.local === 't' || e.local === 'delText') inText = true;
          if (e.local === 'tab') buffer += '\t';
          if (e.local === 'br' || e.local === 'cr') buffer += '\n';
          if (e.local === 'ins') buffer += '[inserted]';
          if (e.local === 'del') buffer += '[deleted]';
          if (['altChunk', 'pict'].includes(e.local)) {
            if (!inParagraph) throw new ExtractError('UNSUPPORTED_TYPE');
            const ref = e.attributes[`{${officeRelNs}}id`];
            if (ref) anchoredRelations.add(ref);
            missing(
              r,
              { ...locator(), component: { kind: 'unsupported-visual', index: ++visual } },
              'vision',
              'UNSUPPORTED_VISUAL',
            );
          }
        }
        if (
          e.kind === 'open' &&
          e.local === 'blip' &&
          e.uri === 'http://schemas.openxmlformats.org/drawingml/2006/main'
        ) {
          if (!inParagraph) throw new ExtractError('UNSUPPORTED_TYPE');
          const ref = e.attributes[`{${officeRelNs}}embed`] ?? e.attributes[`{${officeRelNs}}link`] ?? '';
          anchoredRelations.add(ref);
          pending.push({ ref, locator: { ...locator(), component: { kind: 'image', index: ++visual } } });
        }
        if (
          e.kind === 'open' &&
          ['chart', 'graphicData'].includes(e.local) &&
          e.attributes.uri &&
          !e.attributes.uri.endsWith('/picture')
        )
          missing(
            r,
            { ...locator(), component: { kind: 'unsupported-visual', index: ++visual } },
            'vision',
            'UNSUPPORTED_VISUAL',
          );
        if (e.kind === 'text' && inText) buffer += e.text;
        if (e.kind === 'close' && e.uri === wordNs) {
          if (e.local === 'drawing' && pending.length === drawingImageStart)
            missing(
              r,
              { ...locator(), component: { kind: 'unsupported-visual', index: ++visual } },
              'vision',
              'UNSUPPORTED_VISUAL',
            );
          if (['t', 'delText'].includes(e.local)) inText = false;
          if (e.local === 'p' && inParagraph) {
            append(r, locator(), Buffer.from(buffer), 'text', c);
            inParagraph = false;
          }
          if (e.local === 'tbl') {
            const previous = tableStack.pop();
            if (!previous) throw new ExtractError('CORRUPT_DOCUMENT');
            ({ table, row, cell } = previous);
          }
        }
      }
      for (const image of pending) {
        const relation = rels.find((x) => x.id === image.ref);
        await appendOfficeImage(
          r,
          relation && !relation.external ? parts.get(relation.target) : undefined,
          image.locator,
          c,
        );
      }
      for (const rel of rels)
        if (rel.external && !rel.type.endsWith('/hyperlink') && !anchoredRelations.has(rel.id))
          throw new ExtractError('UNSUPPORTED_TYPE');
      await drainFiles(r, c);
    }
    if (!r.units.length) throw new ExtractError('UNSUPPORTED_TYPE');
    return r;
  } catch (e) {
    return failure(e);
  }
}
