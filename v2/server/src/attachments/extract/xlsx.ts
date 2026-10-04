import { appendOfficeImage, events, officeRelNs, relationships, sheetNs, validateOffice } from './docx.ts';
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
import { readOfficeParts } from './zip.ts';
export async function extractXlsx(bytes: Uint8Array, c: ExtractContext): Promise<ExtractResult> {
  try {
    const parts = await readOfficeParts(bytes, c);
    const main = validateOffice(parts, 'xlsx', c);
    if ([...parts.keys()].some((p) => /externalLinks|pivot/.test(p)))
      throw new ExtractError('UNSUPPORTED_TYPE');
    const r = empty();
    const wb = parts.get(main);
    if (!wb) throw new ExtractError('CORRUPT_DOCUMENT');
    const rels = relationships(parts, main, c);
    if (rels.some((rel) => rel.external)) throw new ExtractError('UNSUPPORTED_TYPE');
    const shared: string[] = [];
    let sharedText = '',
      inside = false;
    const ss = parts.get('xl/sharedStrings.xml');
    if (ss)
      for (const e of events(ss, c)) {
        if (e.kind === 'open' && e.local === 'si') {
          inside = true;
          sharedText = '';
        }
        if (e.kind === 'text' && inside) sharedText += e.text;
        if (e.kind === 'close' && e.local === 'si') {
          shared.push(sharedText);
          inside = false;
        }
      }
    const styleRows: Record<string, string>[] = [];
    const styles = parts.get('xl/styles.xml');
    if (styles)
      for (const e of events(styles, c))
        if (e.kind === 'open' && ['numFmt', 'xf'].includes(e.local)) styleRows.push({ ...e.attributes });
    for (const sheet of events(wb, c).filter(
      (e) => e.kind === 'open' && e.uri === sheetNs && e.local === 'sheet',
    )) {
      const name = sheet.attributes.name ?? '';
      const id = sheet.attributes[`{${officeRelNs}}id`] ?? '';
      const rel = rels.find((v) => v.id === id);
      if (!name || !rel || rel.external) throw new ExtractError('CORRUPT_DOCUMENT');
      const part = rel.target;
      const data = parts.get(part);
      if (!data) throw new ExtractError('CORRUPT_DOCUMENT');
      const hidden = ['hidden', 'veryHidden'].includes(sheet.attributes.state ?? '');
      const locator = (range: string) => ({ kind: 'sheet' as const, part, sheet: name, range, hidden });
      const structuralEvents = events(data, c);
      const root = structuralEvents.find((e) => e.kind === 'open');
      if (root?.uri !== sheetNs || root.local !== 'worksheet') throw new ExtractError('UNSUPPORTED_TYPE');
      let current: {
        ref: string;
        type: string;
        style: string;
        formula: string | null;
        formulaAttrs: Readonly<Record<string, string>>;
        value: string | null;
        inline: string;
      } | null = null;
      let capture: 'value' | 'formula' | 'inline' | null = null;
      let count = 0;
      const rows = new Map<
        number,
        {
          ref: string;
          type: string;
          style: string;
          formula: string | null;
          formulaAttrs: Readonly<Record<string, string>>;
          value: string | null;
          inline: string;
        }[]
      >();
      const missingCaches: string[] = [];
      const merged: string[] = [];
      for (const e of structuralEvents) {
        if (e.uri && e.uri !== sheetNs) continue;
        if (e.kind === 'open') {
          if (e.local === 'c') {
            const ref = e.attributes.r ?? '';
            if (!/^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(ref)) throw new ExtractError('CORRUPT_DOCUMENT');
            current = {
              ref,
              type: e.attributes.t ?? 'n',
              style: e.attributes.s ?? '0',
              formula: null,
              formulaAttrs: {},
              value: null,
              inline: '',
            };
          }
          if (e.local === 'v' && current) {
            capture = 'value';
            current.value = '';
          }
          if (e.local === 'f' && current) {
            capture = 'formula';
            current.formula = '';
            current.formulaAttrs = e.attributes;
          }
          if (e.local === 't' && current) capture = 'inline';
          if (e.local === 'mergeCell' && e.attributes.ref) merged.push(e.attributes.ref);
        }
        if (e.kind === 'text' && current && capture) {
          if (capture === 'inline') current.inline += e.text;
          else if (capture === 'value') current.value = (current.value ?? '') + e.text;
          else current.formula = (current.formula ?? '') + e.text;
        }
        if (e.kind === 'close') {
          if (['v', 'f', 't'].includes(e.local)) capture = null;
          if (e.local === 'c' && current) {
            const position = cellPosition(current.ref);
            if (
              ++count > c.config.limits.maxCsvRows * c.config.limits.maxCsvColumns ||
              position.row > c.config.limits.maxCsvRows ||
              position.col > c.config.limits.maxCsvColumns
            ) {
              missing(r, locator(current.ref), 'text', 'LIMIT_EXCEEDED');
              break;
            }
            if (current.type === 's') {
              const index = Number(current.value);
              if (!Number.isSafeInteger(index) || shared[index] === undefined)
                throw new ExtractError('CORRUPT_DOCUMENT');
              current.inline = shared[index] ?? '';
            }
            if (
              current.formula !== null &&
              (current.value === null || (current.value === '' && current.type !== 'str'))
            )
              missingCaches.push(current.ref);
            const row = Number(current.ref.match(/[0-9]+$/)?.[0]);
            const cells = rows.get(row) ?? [];
            if (cells.some((cell) => cell.ref === current?.ref)) throw new ExtractError('CORRUPT_DOCUMENT');
            cells.push(current);
            rows.set(row, cells);
            current = null;
          }
        }
      }
      let emitted = 0;
      const orderedRows = [...rows.entries()].sort(([a], [b]) => a - b);
      const groupSize = Math.max(1, Math.ceil(orderedRows.length / 8000));
      const sharedFormulas = new Map<string, { ref: string; formula: string }>();
      for (const [, cells] of orderedRows)
        for (const cell of cells)
          if (cell.formulaAttrs.t === 'shared' && cell.formula && cell.formulaAttrs.si)
            sharedFormulas.set(cell.formulaAttrs.si, { ref: cell.ref, formula: cell.formula });
      for (let offset = 0; offset < orderedRows.length; offset += groupSize) {
        const cells = orderedRows.slice(offset, offset + groupSize).flatMap(([, cells]) => cells);
        const positions = cells.map((cell) => cellPosition(cell.ref));
        const bounds = positions.reduce(
          (b, p) => ({
            minCol: Math.min(b.minCol, p.col),
            maxCol: Math.max(b.maxCol, p.col),
            minRow: Math.min(b.minRow, p.row),
            maxRow: Math.max(b.maxRow, p.row),
          }),
          { minCol: 16384, maxCol: 1, minRow: 1048576, maxRow: 1 },
        );
        const range = `${columnName(bounds.minCol)}${bounds.minRow}:${columnName(bounds.maxCol)}${bounds.maxRow}`;
        const body = Buffer.from(
          `${JSON.stringify({
            sheet: name,
            hidden,
            cells: cells.map((cell) => ({
              ...cell,
              sharedFormulaSource:
                cell.formulaAttrs.t === 'shared'
                  ? (sharedFormulas.get(cell.formulaAttrs.si ?? '') ?? null)
                  : null,
              raw: cell.value,
              cached: cell.formula !== null ? cell.value : null,
            })),
            merged,
            styles: styleRows,
          })}\n`,
        );
        emitted += body.length;
        if (emitted > c.config.limits.maxTextBytes) {
          missing(r, locator(range), 'text', 'LIMIT_EXCEEDED');
          break;
        }
        if (!append(r, locator(range), body, 'text', c)) break;
        await drainFiles(r, c);
      }
      for (const ref of missingCaches)
        missing(
          r,
          { ...locator(ref), component: { kind: 'calculated-value', index: 1 } },
          'text',
          'FORMULA_CACHE_MISSING',
        );
      let visual = 0;
      const sheetEvents = events(data, c);
      for (const relation of relationships(parts, part, c)) {
        if (relation.external) {
          const anchor = sheetEvents.find(
            (e) =>
              e.kind === 'open' &&
              e.local === 'hyperlink' &&
              e.attributes[`{${officeRelNs}}id`] === relation.id,
          )?.attributes.ref;
          if (!anchor) throw new ExtractError('UNSUPPORTED_TYPE');
          missing(
            r,
            { ...locator(anchor), component: { kind: 'external', index: ++visual } },
            'text',
            'EXTERNAL_RESOURCE_UNAVAILABLE',
          );
          continue;
        }
        if (relation.type.endsWith('/drawing')) {
          const drawing = parts.get(relation.target);
          if (!drawing) throw new ExtractError('UNSUPPORTED_TYPE');
          const drawingRels = relationships(parts, relation.target, c);
          const anchors = drawingAnchors(events(drawing, c));
          if (!anchors.length) throw new ExtractError('UNSUPPORTED_TYPE');
          for (const anchor of anchors) {
            for (const ref of anchor.images) {
              const imageRel = drawingRels.find((x) => x.id === ref);
              await appendOfficeImage(
                r,
                imageRel && !imageRel.external ? parts.get(imageRel.target) : undefined,
                { ...locator(anchor.range), component: { kind: 'image', index: ++visual } },
                c,
              );
            }
            if (anchor.unsupported || !anchor.images.length)
              missing(
                r,
                { ...locator(anchor.range), component: { kind: 'unsupported-visual', index: ++visual } },
                'vision',
                'UNSUPPORTED_VISUAL',
              );
          }
        } else if (relation.type.endsWith('/comments')) {
          const comment = parts.get(relation.target);
          if (!comment) throw new ExtractError('CORRUPT_DOCUMENT');
          let ref: string | null = null,
            body = '';
          for (const event of events(comment, c)) {
            if (event.kind === 'open' && event.local === 'comment') {
              ref = event.attributes.ref ?? null;
              body = '';
            }
            if (event.kind === 'text' && ref) body += event.text;
            if (event.kind === 'close' && event.local === 'comment') {
              if (!ref || !/^\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6}$/.test(ref))
                throw new ExtractError('CORRUPT_DOCUMENT');
              append(
                r,
                { ...locator(ref), component: { kind: 'comment', index: ++visual } },
                Buffer.from(body),
                'text',
                c,
              );
              ref = null;
            }
          }
        } else if (!relation.type.endsWith('/hyperlink')) throw new ExtractError('UNSUPPORTED_TYPE');
      }
      await drainFiles(r, c);
      if (!rows.size)
        append(
          r,
          locator('A1:A1'),
          Buffer.from(JSON.stringify({ sheet: name, hidden, cells: [] })),
          'text',
          c,
        );
    }
    return r;
  } catch (e) {
    return failure(e);
  }
}

function drawingAnchors(
  nodes: import('./xml.ts').XmlEvent[],
): { range: string; images: string[]; unsupported: boolean }[] {
  const anchors: { range: string; images: string[]; unsupported: boolean }[] = [];
  let current: {
    from: { row: number; col: number };
    to: { row: number; col: number } | null;
    images: string[];
    unsupported: boolean;
  } | null = null;
  let marker: 'from' | 'to' | null = null,
    field: 'row' | 'col' | null = null;
  const column = (n: number) => {
    let s = '';
    for (let x = n + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
    return s;
  };
  for (const e of nodes) {
    if (e.kind === 'open') {
      if (['oneCellAnchor', 'twoCellAnchor', 'absoluteAnchor'].includes(e.local)) {
        if (e.local === 'absoluteAnchor') throw new ExtractError('UNSUPPORTED_TYPE');
        current = { from: { row: -1, col: -1 }, to: null, images: [], unsupported: false };
      }
      if (current && ['from', 'to'].includes(e.local)) {
        marker = e.local as 'from' | 'to';
        if (marker === 'to') current.to = { row: -1, col: -1 };
      }
      if (current && marker && ['row', 'col'].includes(e.local)) field = e.local as 'row' | 'col';
      if (current && e.local === 'blip' && e.uri === 'http://schemas.openxmlformats.org/drawingml/2006/main')
        current.images.push(
          e.attributes[`{${officeRelNs}}embed`] ?? e.attributes[`{${officeRelNs}}link`] ?? '',
        );
      if (current && ['chart', 'sp', 'graphicFrame', 'cxnSp'].includes(e.local)) current.unsupported = true;
    }
    if (e.kind === 'text' && current && marker && field) {
      const n = Number(e.text);
      if (!Number.isSafeInteger(n) || n < 0 || n > 1048575) throw new ExtractError('CORRUPT_DOCUMENT');
      const pos = marker === 'from' ? current.from : current.to;
      if (pos) pos[field] = n;
    }
    if (e.kind === 'close') {
      if (['row', 'col'].includes(e.local)) field = null;
      if (['from', 'to'].includes(e.local)) marker = null;
      if (current && ['oneCellAnchor', 'twoCellAnchor'].includes(e.local)) {
        const end = current.to ?? current.from;
        if (
          [current.from.row, current.from.col, end.row, end.col].some((x) => x < 0) ||
          current.from.col > 16383 ||
          end.col > 16383
        )
          throw new ExtractError('CORRUPT_DOCUMENT');
        anchors.push({
          range: `${column(current.from.col)}${current.from.row + 1}:${column(end.col)}${end.row + 1}`,
          images: current.images,
          unsupported: current.unsupported,
        });
        current = null;
      }
    }
  }
  return anchors;
}

function cellPosition(ref: string): { row: number; col: number } {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(ref);
  if (!match) throw new ExtractError('CORRUPT_DOCUMENT');
  let col = 0;
  for (const char of match[1] ?? '') col = col * 26 + char.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (col > 16384 || row > 1048576) throw new ExtractError('CORRUPT_DOCUMENT');
  return { row, col };
}
function columnName(col: number): string {
  let result = '';
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26))
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
  return result;
}
