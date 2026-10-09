import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { MacContext } from '../context.js';
import type { CommandRunner } from '../system.js';
import { type AttachmentMeta, type BridgeClient, BridgeError, type CommentMeta } from './bridge.js';
import { ensureCacheDirs, hasBlob, storeBlob, writeRunManifest } from './cache.js';
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_RUN,
  MAX_PDF_PAGES,
  RELIST_DELAY_MS,
  RELIST_IF_ISSUE_YOUNGER_MS,
} from './config.js';
import { runGc } from './gc.js';
import { prepareImage } from './image.js';
import { logLine } from './log.js';
import { type AttachmentPaths, attachmentPaths, blobPath, derivedDir, isSha256 } from './paths.js';
import { inspectPdf, pdfReadHint } from './pdf.js';
import { decide } from './policy.js';
import { type SourceText, sanitizeName, sourceFor } from './provenance.js';
import { detectKind } from './sniff.js';
import type {
  BlockLabel,
  CredentialFinding,
  DetectedKind,
  FileStatus,
  ManifestFile,
  NoteCode,
  ReasonCode,
  RunManifest,
} from './types.js';

const DOWNLOAD_CONCURRENCY = 4;

export type ExtractKind = 'text' | 'csv' | 'docx' | 'xlsx';
export interface ExtractRequest {
  kind: ExtractKind;
  blobPath: string;
  sha256: string;
  filename: string;
  /** Thư mục `derived/<sha>/v<N>`; kết quả ghi ở đây. */
  outDir: string;
}
export interface ExtractResult {
  status: 'complete' | 'partial' | 'encrypted' | 'blocked' | 'unsupported' | 'corrupt' | 'failed';
  /** Đường dẫn tương đối `outDir`; chữ chưa che credential. */
  outputs: { path: string; kind: 'text' | 'image' }[];
  notes: { code: NoteCode; count?: number; name?: string }[];
  problemCodes: string[];
}
export type ExtractFn = (request: ExtractRequest) => Promise<ExtractResult>;
/** Che credential trong file trích (ghi đè tại chỗ) và trả danh sách phát hiện (chỉ tên luật và số dòng). */
export type RedactFn = (path: string) => Promise<CredentialFinding[]>;

export interface FilesDeps {
  ctx: MacContext;
  bridge: BridgeClient;
  runner: CommandRunner;
  sleep(ms: number): Promise<void>;
  extract?: ExtractFn;
  redact?: RedactFn;
}

interface Entry {
  meta: AttachmentMeta;
  issueKey: string;
  relation: 'self' | 'ancestor';
  texts: SourceText[];
}

type Outcome = Pick<ManifestFile, 'status' | 'reason' | 'notes' | 'readPaths' | 'credentialFindings'> &
  Partial<Pick<ManifestFile, 'pages' | 'blockLabel' | 'noteDetails' | 'detected'>>;

const fail = (status: FileStatus, reason: ReasonCode, extra: Partial<Outcome> = {}): Outcome => ({
  status,
  reason,
  notes: [],
  readPaths: [],
  credentialFindings: [],
  ...extra,
});

const READ_EXTENSION: Partial<Record<DetectedKind, string>> = {
  png: 'png',
  jpeg: 'jpg',
  gif: 'gif',
  webp: 'webp',
  pdf: 'pdf',
};

/** Claude Code `Read` nhận ảnh/PDF theo đuôi file nên blob (tên là sha256) được nối cứng sang tên có đuôi. */
function readableCopy(p: AttachmentPaths, sha256: string, blob: string, ext: string): string {
  const dir = derivedDir(p, sha256);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = join(dir, `${sha256}.${ext}`);
  if (existsSync(target)) return target;
  const temp = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    linkSync(blob, temp);
  } catch {
    copyFileSync(blob, temp);
  }
  try {
    renameSync(temp, target);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // không còn gì để dọn
    }
    throw error;
  }
  return target;
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function newestFirst(list: AttachmentMeta[]): AttachmentMeta[] {
  return list
    .map((meta, index) => ({ meta, index }))
    .sort(
      (a, b) =>
        (Date.parse(b.meta.createdAt) || 0) - (Date.parse(a.meta.createdAt) || 0) || a.index - b.index,
    )
    .map((x) => x.meta);
}

function sourceTexts(issueKey: string, description: string | null, comments: CommentMeta[]): SourceText[] {
  const texts: SourceText[] = [
    { kind: 'description', issueKey, ordinal: null, author: null, commentId: null, text: description ?? '' },
  ];
  const ordered = comments
    .map((c, index) => ({ c, index }))
    .sort((a, b) => (Date.parse(a.c.createdAt) || 0) - (Date.parse(b.c.createdAt) || 0) || a.index - b.index);
  for (const [i, { c }] of ordered.entries()) {
    texts.push({
      kind: 'comment',
      issueKey,
      ordinal: i + 1,
      author: c.authorUserId ? 'chủ dự án' : 'agent',
      commentId: c.id,
      text: c.body,
    });
  }
  return texts;
}

function fromExtract(result: ExtractResult, p: AttachmentPaths, sha256: string): Outcome {
  const readPaths = result.outputs
    .filter((o) => o.kind === 'text')
    .map((o) => join(derivedDir(p, sha256), o.path));
  const notes = result.notes.map((n) => n.code);
  const noteDetails = result.notes.map((n) => ({
    code: n.code,
    ...(n.count !== undefined ? { count: n.count } : {}),
    ...(n.name !== undefined ? { name: sanitizeName(n.name) } : {}),
  }));
  switch (result.status) {
    case 'complete':
      return { status: 'san_sang', reason: null, notes, noteDetails, readPaths, credentialFindings: [] };
    case 'partial':
      return { status: 'mot_phan', reason: null, notes, noteDetails, readPaths, credentialFindings: [] };
    case 'encrypted':
      return fail('ma_hoa', 'office_ma_hoa');
    case 'blocked':
      return fail('bi_chan', 'office_macro');
    case 'unsupported':
      return result.problemCodes.includes('UNSUPPORTED_ENCODING')
        ? fail('khong_doc_duoc', 'khong_utf8')
        : fail('bi_chan', 'kieu_cam', { blockLabel: 'khac' });
    case 'corrupt':
      return fail('hong', 'hong_cau_truc');
    case 'failed':
      // Cả file vượt trần trình đọc (zip bomb, XML quá sâu, quá nhiều mục): coi là file hỏng, không phải lỗi tạm.
      return result.problemCodes.includes('LIMIT_EXCEEDED')
        ? fail('hong', 'hong_cau_truc')
        : fail('khong_doc_duoc', 'trinh_doc_loi');
    default:
      return fail('khong_doc_duoc', 'trinh_doc_loi');
  }
}

/**
 * Lấy file đính kèm của issue và tổ tiên qua bridge, lưu cache, nhận diện theo byte và ghi manifest của run.
 * Mỗi file lỗi có trạng thái và lý do cố định; một file hỏng không làm hỏng các file khác.
 */
export async function collectFiles(
  deps: FilesDeps,
  input: { issueId: string; runId: string },
): Promise<RunManifest> {
  const { ctx, bridge } = deps;
  const p = attachmentPaths(ctx.home);
  ensureCacheDirs(p);
  try {
    await runGc(p, { now: ctx.now(), currentRunId: input.runId });
  } catch {
    // dọn cache hỏng không được chặn việc đọc file
  }

  const loadSelf = () =>
    Promise.all([
      bridge.issue(input.issueId),
      bridge.comments(input.issueId).catch((): CommentMeta[] => []),
      bridge.attachments(input.issueId),
    ]);
  let [issue, comments, listing] = await loadSelf();

  const issueAge = ctx.now().getTime() - (Date.parse(issue.createdAt) || 0);
  if (issueAge >= 0 && issueAge < RELIST_IF_ISSUE_YOUNGER_MS) {
    await deps.sleep(RELIST_DELAY_MS);
    [issue, comments, listing] = await loadSelf();
  }

  let ancestorsUnreadable = false;
  const ancestors = await bridge.heartbeatContext(input.issueId).then(
    (h) => h.ancestors,
    () => {
      ancestorsUnreadable = true;
      return [];
    },
  );
  const ancestorListings = await Promise.all(
    ancestors.map((a) =>
      bridge.attachments(a.id).then(
        (list) => list,
        () => {
          ancestorsUnreadable = true;
          return [] as AttachmentMeta[];
        },
      ),
    ),
  );

  const selfKey = issue.identifier || input.issueId.slice(0, 8);
  const selfTexts = sourceTexts(selfKey, issue.description, comments);
  const entries: Entry[] = newestFirst(listing).map((meta) => ({
    meta,
    issueKey: selfKey,
    relation: 'self',
    texts: selfTexts,
  }));
  ancestors.forEach((a, i) => {
    for (const meta of newestFirst(ancestorListings[i] ?? []))
      entries.push({ meta, issueKey: a.identifier || a.id.slice(0, 8), relation: 'ancestor', texts: [] });
  });

  const generatedAt = ctx.now();
  const files = await mapLimit(entries, DOWNLOAD_CONCURRENCY, (entry, index) =>
    processEntry(deps, p, input.runId, entry, index >= MAX_FILES_PER_RUN, generatedAt),
  );

  const manifest: RunManifest = {
    version: 1,
    runId: input.runId,
    issueId: input.issueId,
    transport: 'bridge',
    generatedAt: generatedAt.toISOString(),
    files,
    ...(ancestorsUnreadable ? { ancestorsUnreadable: true as const } : {}),
  };
  writeRunManifest(p, manifest);
  return manifest;
}

async function processEntry(
  deps: FilesDeps,
  p: AttachmentPaths,
  runId: string,
  entry: Entry,
  overLimit: boolean,
  now: Date,
): Promise<ManifestFile> {
  const { meta } = entry;
  const filename = sanitizeName(meta.originalFilename ?? '') || `attachment-${meta.id.slice(0, 8)}`;
  let detected: DetectedKind = 'unknown';
  let byteSize = meta.byteSize;
  let note: 'tai_bridge' | 'cache_hit' | undefined;

  let outcome: Outcome;
  try {
    if (overLimit) {
      outcome = fail('qua_lon', 'vuot_40_file');
    } else if (meta.byteSize > MAX_FILE_BYTES) {
      outcome = fail('qua_lon', 'vuot_10mb');
    } else if (!isSha256(meta.sha256)) {
      outcome = fail('khong_doc_duoc', 'tai_loi');
    } else {
      const stored = await ensureBlob(deps, p, meta, now);
      if ('outcome' in stored) {
        outcome = stored.outcome;
      } else {
        note = stored.note;
        const blob = blobPath(p, meta.sha256);
        const bytes = readFileSync(blob);
        byteSize = bytes.length;
        detected = detectKind(bytes, filename, meta.contentType);
        outcome = await handle(deps, p, meta.sha256, blob, detected, filename);
      }
    }
  } catch {
    outcome = fail('khong_doc_duoc', 'trinh_doc_loi');
  }

  logLine(p, {
    now,
    runId,
    attachmentId: meta.id,
    sha256: meta.sha256,
    bytes: byteSize,
    status: outcome.status,
    reason: outcome.reason,
    ...(note ? { note } : {}),
  });

  const { detected: outcomeKind, pages, blockLabel, noteDetails, ...rest } = outcome;
  return {
    attachmentId: meta.id,
    issueId: meta.issueId,
    issueKey: entry.issueKey,
    relation: entry.relation,
    issueCommentId: meta.issueCommentId,
    source: sourceFor(meta, entry.issueKey, entry.relation, entry.texts),
    filename,
    declaredType: meta.contentType,
    detected: outcomeKind ?? detected,
    byteSize,
    sha256: meta.sha256,
    pages: pages ?? null,
    ...rest,
    ...(blockLabel ? { blockLabel } : {}),
    ...(noteDetails ? { noteDetails } : {}),
  };
}

/** Blob có trong cache hoặc được tải về; lỗi tải thành kết quả có lý do cố định. */
async function ensureBlob(
  deps: FilesDeps,
  p: AttachmentPaths,
  meta: AttachmentMeta,
  now: Date,
): Promise<{ note: 'tai_bridge' | 'cache_hit' } | { outcome: Outcome }> {
  if (hasBlob(p, meta.sha256)) return { note: 'cache_hit' };
  try {
    const stream = await deps.bridge.content(meta.id, MAX_FILE_BYTES);
    const stored = await storeBlob(p, meta.sha256, stream, MAX_FILE_BYTES);
    if (!stored.ok)
      return {
        outcome: stored.reason === 'sai_ma_bam' ? fail('hong', 'sai_ma_bam') : fail('qua_lon', 'vuot_10mb'),
      };
    return { note: 'tai_bridge' };
  } catch (error) {
    if (error instanceof BridgeError) {
      if (error.code === 'too_large') return { outcome: fail('qua_lon', 'vuot_10mb') };
      const justUploaded = now.getTime() - (Date.parse(meta.createdAt) || 0) < RELIST_IF_ISSUE_YOUNGER_MS;
      if (error.code === 'http' && error.status === 404 && justUploaded)
        return { outcome: fail('chua_dong_bo', 'chua_len_kip') };
    }
    return { outcome: fail('khong_doc_duoc', 'tai_loi') };
  }
}

async function handle(
  deps: FilesDeps,
  p: AttachmentPaths,
  sha256: string,
  blob: string,
  detected: DetectedKind,
  filename: string,
): Promise<Outcome> {
  const decision = decide(detected, filename);
  switch (decision.action) {
    case 'reject':
      return fail(
        decision.status,
        decision.reason,
        decision.label ? { blockLabel: decision.label as BlockLabel } : {},
      );
    case 'image': {
      const prepared = await prepareImage(
        deps.runner,
        blob,
        detected as 'png' | 'jpeg' | 'gif' | 'webp' | 'heic',
        derivedDir(p, sha256),
      );
      if ('error' in prepared) return fail('khong_doc_duoc', 'doi_anh_loi');
      const readPath =
        prepared.readPath === blob
          ? readableCopy(p, sha256, blob, READ_EXTENSION[detected] ?? 'png')
          : prepared.readPath;
      return {
        status: 'san_sang',
        reason: null,
        notes: prepared.resized ? ['anh_da_thu_nho'] : [],
        readPaths: [readPath],
        credentialFindings: [],
      };
    }
    case 'pdf': {
      const info = await inspectPdf(deps.runner, blob);
      if ('error' in info) return fail('hong', 'hong_cau_truc');
      if (info.encrypted) return fail('ma_hoa', 'pdf_ma_hoa');
      if (info.pages > MAX_PDF_PAGES) return fail('qua_lon', 'vuot_200_trang');
      return {
        status: 'san_sang',
        reason: null,
        notes: pdfReadHint(info.pages) ? ['pdf_doc_theo_trang'] : [],
        pages: info.pages,
        readPaths: [readableCopy(p, sha256, blob, 'pdf')],
        credentialFindings: [],
      };
    }
    case 'extract': {
      // Không có trình đọc thì file không đọc được; có trình đọc mà không có bộ che thì không đưa chữ trích ra.
      if (!deps.extract || !deps.redact) return fail('khong_doc_duoc', 'trinh_doc_loi');
      const result = await deps.extract({
        kind: decision.kind,
        blobPath: blob,
        sha256,
        filename,
        outDir: derivedDir(p, sha256),
      });
      const outcome = fromExtract(result, p, sha256);
      const findings: CredentialFinding[] = [];
      for (const path of outcome.readPaths) findings.push(...(await deps.redact(path)));
      return { ...outcome, credentialFindings: findings };
    }
  }
}
