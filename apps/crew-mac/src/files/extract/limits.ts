// Port từ v2/server/src/attachments/config.ts và contracts.ts (a13dd7d): chỉ phần trình đọc file cần.

/** Trần của trình đọc file; số giữ nguyên bản v2. */
export type ParserLimits = {
  maxExpandedBytes: number;
  maxEntryBytes: number;
  maxZipEntries: number;
  maxCompressionRatio: number;
  maxXmlDepth: number;
  maxTextNodeBytes: number;
  maxTextBytes: number;
  maxCsvRows: number;
  maxCsvColumns: number;
  maxCsvFieldBytes: number;
  maxPdfPages: number;
  pdfDpi: number;
  maxPagePixels: number;
  maxImagePixels: number;
  maxOutputBytes: number;
};

const MiB = 1024 * 1024;

export const parserDefaults: Readonly<ParserLimits> = Object.freeze({
  maxExpandedBytes: 100 * MiB,
  maxEntryBytes: 20 * MiB,
  maxZipEntries: 2000,
  maxCompressionRatio: 100,
  maxXmlDepth: 64,
  maxTextNodeBytes: MiB,
  maxTextBytes: 10 * MiB,
  maxCsvRows: 100000,
  maxCsvColumns: 1000,
  maxCsvFieldBytes: MiB,
  maxPdfPages: 200,
  pdfDpi: 144,
  maxPagePixels: 20_000_000,
  maxImagePixels: 40_000_000,
  maxOutputBytes: 100 * MiB,
});

export type WorkerConfig = { limits: ParserLimits };

export type ExtractStatus =
  | 'complete'
  | 'partial'
  | 'encrypted'
  | 'corrupt'
  | 'unsupported'
  | 'blocked'
  | 'failed';

export type Problem = { code: string; message: string; unitIds: string[] };

export type SourceComponent = {
  kind: 'image' | 'unsupported-visual' | 'calculated-value' | 'comment' | 'external';
  index: number;
};

export type SourceLocator =
  | { kind: 'text'; byteStart: number; byteEnd: number; lineStart: number; lineEnd: number }
  | {
      kind: 'docx';
      part: string;
      paragraph: number;
      table: number | null;
      row: number | null;
      cell: number | null;
      component?: SourceComponent;
    }
  | {
      kind: 'sheet';
      part: string;
      sheet: string;
      range: string;
      hidden: boolean;
      component?: SourceComponent;
    }
  | { kind: 'csv'; rowStart: number; rowEnd: number; columnStart: number; columnEnd: number };

export type CoverageUnit = {
  id: string;
  locator: SourceLocator;
  needs: 'text' | 'vision';
  state: 'available' | 'missing';
  reason: string | null;
};
