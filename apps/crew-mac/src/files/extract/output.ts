import type { NoteCode } from '../types.js';
import { extractCsv } from './csv.js';
import { extractDocx } from './docx.js';
import { type ExtractContext, type ExtractResult, extractText, extractXlsx } from './index.js';
import { type ParserLimits, parserDefaults, type SourceLocator } from './limits.js';
import { decodeText, escapeText } from './text.js';

export type ExtractKind = 'text' | 'csv' | 'docx' | 'xlsx';
export type OutputStatus =
  | 'complete'
  | 'partial'
  | 'encrypted'
  | 'blocked'
  | 'unsupported'
  | 'corrupt'
  | 'failed';
export interface OutputNote {
  code: NoteCode;
  count?: number;
  name?: string;
}
export interface OutputFile {
  /** Tương đối thư mục đầu ra; chỉ gồm tên đã làm sạch hoặc `media/<n>.<đuôi>`. */
  path: string;
  kind: 'text' | 'image';
  bytes: Uint8Array;
}
export interface Outputs {
  status: OutputStatus;
  /** Chữ CHƯA che credential. */
  outputs: OutputFile[];
  notes: OutputNote[];
  /** Mã lỗi v2 (không có thông điệp). */
  problemCodes: string[];
}

const TEXT_EXT: Record<ExtractKind, string> = { text: 'txt', csv: 'csv', docx: 'md', xlsx: 'md' };

/** Tên file đầu ra: bỏ đuôi gốc, chỉ giữ chữ/số/`._-`, không bắt đầu bằng dấu chấm, tối đa 80 ký tự. */
export function outputStem(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const stem = (dot > 0 ? base.slice(0, dot) : base)
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[.-]+/, '')
    .replace(/-+$/, '')
    .slice(0, 80);
  return stem || 'noi-dung';
}

function bodyOf(r: ExtractResult, unitId: string): string {
  const file = r.files.find((f) => f.unitIds.includes(unitId));
  return file ? Buffer.from(file.bytes).toString() : '';
}

function imagePathOf(r: ExtractResult, unitId: string): string | null {
  const file = r.files.find((f) => f.kind === 'image' && f.unitIds.includes(unitId));
  return file ? file.relativeName : null;
}

function notesOf(r: ExtractResult): OutputNote[] {
  const notes: OutputNote[] = [];
  const hidden: string[] = [];
  for (const u of r.units)
    if (u.locator.kind === 'sheet' && u.locator.hidden && !hidden.includes(u.locator.sheet))
      hidden.push(u.locator.sheet);
  for (const name of hidden) notes.push({ code: 'sheet_an', name });
  const gaps = r.units.filter((u) => u.state === 'missing');
  const formula = gaps.filter((u) => u.reason === 'FORMULA_CACHE_MISSING').length;
  if (formula > 0) notes.push({ code: 'thieu_formula_cache', count: formula });
  const visuals = gaps.filter((u) => u.needs === 'vision').length;
  if (visuals > 0) notes.push({ code: 'anh_nhung_bo_qua', count: visuals });
  if (gaps.some((u) => u.reason === 'LIMIT_EXCEEDED')) notes.push({ code: 'vuot_gioi_han' });
  return notes;
}

function docxLabel(l: Extract<SourceLocator, { kind: 'docx' }>): string {
  const where =
    l.table !== null ? `bảng ${l.table}, hàng ${l.row ?? 0}, ô ${l.cell ?? 0}` : `đoạn ${l.paragraph}`;
  if (!l.component) return where;
  const kind = l.component.kind === 'image' ? 'ảnh' : 'hình';
  return `${where}, ${kind} ${l.component.index}`;
}

function gapText(reason: string | null, needs: 'text' | 'vision'): string {
  if (reason === 'LIMIT_EXCEEDED') return '(phần từ đây trở đi vượt giới hạn đọc, đã bỏ qua)';
  if (reason === 'FORMULA_CACHE_MISSING') return '(chưa có giá trị tính sẵn)';
  if (reason === 'EXTERNAL_RESOURCE_UNAVAILABLE' && needs === 'text') return '(liên kết ngoài, không mở)';
  if (needs === 'vision') return '(hình không đọc được)';
  return '(không đọc được)';
}

function docxMarkdown(r: ExtractResult, filename: string): string {
  const lines = [`# ${escapeText(filename)}`, ''];
  let part: string | null = null;
  for (const u of r.units) {
    if (u.locator.kind !== 'docx') continue;
    if (part !== null && u.locator.part !== part) lines.push('', `## Phần ${escapeText(u.locator.part)}`, '');
    if (part === null && u.locator.part !== 'word/document.xml')
      lines.push(`## Phần ${escapeText(u.locator.part)}`, '');
    part = u.locator.part;
    const label = `[${docxLabel(u.locator)}]`;
    if (u.state === 'missing') lines.push(`${label} ${gapText(u.reason, u.needs)}`);
    else if (u.needs === 'vision') lines.push(`${label} ${imagePathOf(r, u.id) ?? ''}`);
    else {
      const text = escapeText(bodyOf(r, u.id));
      if (text.trim()) lines.push(`${label} ${text}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

type SheetCell = {
  ref: string;
  type: string;
  formula: string | null;
  value: string | null;
  inline: string;
  sharedFormulaSource: { ref: string; formula: string } | null;
};

function cellText(cell: SheetCell): string | null {
  let value: string;
  if (cell.type === 's' || cell.type === 'inlineStr') value = cell.inline;
  else if (cell.type === 'b')
    value = cell.value === '1' ? 'TRUE' : cell.value === '0' ? 'FALSE' : (cell.value ?? '');
  else value = cell.value ?? cell.inline;
  if (cell.formula === null) return value === '' ? null : escapeText(value);
  const formula = cell.formula
    ? `=${cell.formula}`
    : cell.sharedFormulaSource
      ? `=(công thức chung từ ${cell.sharedFormulaSource.ref}: ${cell.sharedFormulaSource.formula})`
      : '=(công thức chung)';
  const cached =
    cell.value === null || (cell.value === '' && cell.type !== 'str') ? '(chưa có giá trị tính sẵn)' : value;
  return escapeText(`${formula} → ${cached}`);
}

function xlsxMarkdown(r: ExtractResult, filename: string): string {
  const lines = [`# ${escapeText(filename)}`, ''];
  let sheet: string | null = null;
  for (const u of r.units) {
    if (u.locator.kind !== 'sheet') continue;
    const l = u.locator;
    const name = escapeText(l.sheet);
    if (l.sheet !== sheet) {
      if (sheet !== null) lines.push('');
      lines.push(`## Sheet "${name}"${l.hidden ? ' (ẩn)' : ''}`, '');
      sheet = l.sheet;
    }
    const component = l.component;
    if (u.state === 'missing') {
      // Ô thiếu giá trị công thức đã hiện trong dòng của ô đó.
      if (u.reason !== 'FORMULA_CACHE_MISSING')
        lines.push(`[${name}!${l.range}] ${gapText(u.reason, u.needs)}`);
      continue;
    }
    if (component?.kind === 'image') {
      lines.push(`[${name}!${l.range}, ảnh ${component.index}] ${imagePathOf(r, u.id) ?? ''}`);
      continue;
    }
    if (component?.kind === 'comment') {
      lines.push(`[${name}!${l.range}, ghi chú] ${escapeText(bodyOf(r, u.id))}`);
      continue;
    }
    for (const row of bodyOf(r, u.id).split('\n')) {
      if (!row) continue;
      const parsed = JSON.parse(row) as { cells: SheetCell[] };
      for (const cell of parsed.cells) {
        const text = cellText(cell);
        if (text !== null) lines.push(`[${name}!${cell.ref}] ${text}`);
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Đọc một file theo kiểu đã quyết ở bước nhận diện, trả các file đầu ra (chữ CHƯA che) và trạng thái.
 * Không ném: lỗi trình đọc thành `failed`/`corrupt`… theo mã v2.
 */
export async function extractOutputs(
  kind: ExtractKind,
  bytes: Uint8Array,
  filename: string,
  limits: ParserLimits = parserDefaults,
): Promise<Outputs> {
  const c: ExtractContext = { config: { limits: { ...limits } }, signal: new AbortController().signal };
  try {
    const r =
      kind === 'text'
        ? await extractText(bytes, c)
        : kind === 'csv'
          ? await extractCsv(bytes, c)
          : kind === 'docx'
            ? await extractDocx(bytes, c)
            : await extractXlsx(bytes, c);
    const problemCodes = [...new Set(r.problems.map((p) => p.code))];
    if (r.status !== 'complete' && r.status !== 'partial')
      return { status: r.status, outputs: [], notes: [], problemCodes };

    const name = `${outputStem(filename)}.${TEXT_EXT[kind]}`;
    let text: string;
    if (kind === 'text') text = r.files.map((f) => Buffer.from(f.bytes).toString()).join('');
    else if (kind === 'csv') {
      const decoded = decodeText(bytes).text;
      const cut = (r as Awaited<ReturnType<typeof extractCsv>>).completeChars;
      text = cut === undefined ? decoded : decoded.slice(0, cut);
    } else text = kind === 'docx' ? docxMarkdown(r, filename) : xlsxMarkdown(r, filename);

    const outputs: OutputFile[] = [{ path: name, kind: 'text', bytes: Buffer.from(text) }];
    for (const f of r.files)
      if (f.kind === 'image') outputs.push({ path: f.relativeName, kind: 'image', bytes: f.bytes });
    const notes = notesOf(r);
    return { status: notes.length > 0 ? 'partial' : 'complete', outputs, notes, problemCodes };
  } catch {
    return { status: 'failed', outputs: [], notes: [], problemCodes: ['EXTRACTOR_FAILED'] };
  }
}
