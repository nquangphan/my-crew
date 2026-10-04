/**
 * Owner read side of attachments: policy, ticket attachment refs, extraction manifests and verified bytes for
 * preview. Every byte shown in the page is checked against the SHA-256 and MIME from the producer record,
 * never against the file name; only PNG/JPEG rasters and verified text derivatives are rendered inline.
 *
 * Producer status: the routes are reviewed (`v2/server/src/attachments/routes.ts:344,499,559`) but not
 * mounted in `buildApp` until gate G2. The flattened ticket list has no `commentId`, so grouping by comment
 * waits for the G2 projection; this module never infers it from order.
 */
import { type AttachmentPolicy, decodeAttachmentPolicy, extractStatus } from '../contracts/attachments.ts';
import {
  arr,
  type Decoder,
  type Infer,
  int,
  jsonObject,
  lit,
  matching,
  nullable,
  obj,
  page,
  str,
  uuid,
} from '../contracts/http.ts';
import { ApiFailure, getDecoded, type OwnerClient } from '../lib/api.ts';
import { queryKeys } from '../lib/query-keys.ts';

const sha256 = matching(/^[0-9a-f]{64}$/, 'sha256');

/** Item of GET `/v2/tickets/:id/attachments` (`routes.ts:499`): live links incl. inherited, no commentId. */
export const decodeTicketAttachment = obj({
  linkId: uuid,
  attachmentId: uuid,
  sha256,
  ownerId: lit('owner'),
  fileName: str,
  mime: nullable(str),
  byteLength: int,
});
export type TicketAttachment = Infer<typeof decodeTicketAttachment>;
const decodeTicketAttachmentPage = page(decodeTicketAttachment);

const decodeProblem = obj({ code: str, message: str, unitIds: arr(str) });
const decodeRef = obj({ attachmentId: uuid, sha256, ownerId: lit('owner') });

/** `CoverageUnit`, `contracts.ts:96`; the locator stays an object and is described by `describeLocator`. */
const decodeUnit = obj({
  id: str,
  locator: jsonObject,
  needs: lit('text', 'vision'),
  state: lit('available', 'missing'),
  reason: nullable(str),
});

/** `Derivative`, `contracts.ts:103`. */
export const decodeDerivative = obj({
  id: uuid,
  original: decodeRef,
  extractionId: uuid,
  kind: lit('text', 'image'),
  mime: lit('text/plain', 'image/png'),
  sha256,
  byteLength: int,
  unitIds: arr(str),
  verification: lit('verified', 'failed'),
  extractorVersion: str,
  configSha256: sha256,
});
export type Derivative = Infer<typeof decodeDerivative>;

/** `Extraction`, `contracts.ts:116`. */
export const decodeExtraction = obj({
  id: uuid,
  original: decodeRef,
  status: extractStatus,
  extractorVersion: str,
  configSha256: sha256,
  manifestSha256: sha256,
  units: arr(decodeUnit),
  derivatives: arr(decodeDerivative),
  problems: arr(decodeProblem),
  verification: lit('verified', 'failed'),
});
export type Extraction = Infer<typeof decodeExtraction>;

/** Item of GET `/v2/attachments/:id/extractions` (`routes.ts:575`); `extraction` is null while pending. */
const decodeExtractionItem = obj({
  id: uuid,
  status: extractStatus,
  extractorVersion: str,
  configSha256: sha256,
  manifestSha256: nullable(sha256),
  extraction: nullable(decodeExtraction),
});
export type ExtractionItem = Infer<typeof decodeExtractionItem>;
const decodeExtractionPage = page(decodeExtractionItem);

export const attachmentQueryKeys = {
  policy: () => ['v2', 'attachment-policy'] as const,
  ticket: (ticketId: string) => queryKeys.attachments(ticketId),
  extractions: (attachmentId: string) => ['v2', 'attachments', 'extractions', attachmentId] as const,
};

/** Hard cap on pages read for one list so a broken cursor cannot loop forever. */
const maxPages = 100;

async function allPages<T>(
  client: OwnerClient,
  path: string,
  decoder: Decoder<{ items: T[]; nextCursor: string | null }>,
  signal?: AbortSignal,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let index = 0; index < maxPages; index++) {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const result: { items: T[]; nextCursor: string | null } = await getDecoded(
      client,
      `${path}?${query.toString()}`,
      decoder,
      signal,
    );
    items.push(...result.items);
    if (!result.nextCursor) return items;
    if (result.nextCursor === cursor) break;
    cursor = result.nextCursor;
  }
  throw new ApiFailure(null, 'PAGINATION_LIMIT', 'shape');
}

export function attachmentPolicyQuery(client: OwnerClient) {
  return {
    queryKey: attachmentQueryKeys.policy(),
    queryFn: ({ signal }: { signal?: AbortSignal }): Promise<AttachmentPolicy> =>
      getDecoded(client, '/v2/attachment-policy', decodeAttachmentPolicy, signal),
    staleTime: 60_000,
    retry: false,
  };
}

export function ticketAttachmentsQuery(client: OwnerClient, ticketId: string) {
  return {
    queryKey: attachmentQueryKeys.ticket(ticketId),
    queryFn: ({ signal }: { signal?: AbortSignal }) =>
      allPages(
        client,
        `/v2/tickets/${encodeURIComponent(ticketId)}/attachments`,
        decodeTicketAttachmentPage,
        signal,
      ),
    retry: false,
  };
}

export function extractionsQuery(client: OwnerClient, attachmentId: string) {
  return {
    queryKey: attachmentQueryKeys.extractions(attachmentId),
    queryFn: ({ signal }: { signal?: AbortSignal }) =>
      allPages(
        client,
        `/v2/attachments/${encodeURIComponent(attachmentId)}/extractions`,
        decodeExtractionPage,
        signal,
      ),
    retry: false,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Verified bytes

export type SafeRaster = 'image/png' | 'image/jpeg';

/** Magic bytes of the only raster types rendered inline. SVG/HTML/PDF never qualify. */
export function sniffRaster(head: Uint8Array): SafeRaster | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (head.length >= 8 && png.every((byte, index) => head[index] === byte)) return 'image/png';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  return null;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Largest original/derivative this page reads into memory for preview. */
export const previewMaxBytes = 16 * 1024 * 1024;
/** Largest text shown inline; the rest stays in the download. */
export const textPreviewMaxChars = 64 * 1024;

export type VerifiedBytes = { blob: Blob; mime: string };

export type ByteFetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Same-origin owner GET of attachment bytes with the cookie. The SHA-256 must equal the producer record and
 * the content type is taken from that record plus magic bytes, never from the file name or the response.
 * `onUnauthorized` lets the caller expire the session on 401.
 */
export async function fetchVerifiedBytes(input: {
  fetch: ByteFetch;
  path: string;
  expectedSha256: string;
  expectedBytes: number;
  expectedMime: string;
  signal?: AbortSignal;
  onUnauthorized?: () => void;
}): Promise<VerifiedBytes> {
  if (!/^\/v2\/attachments\/[0-9a-f-]{36}(\/derivatives\/[0-9a-f-]{36})?\/content$/.test(input.path))
    throw new ApiFailure(null, 'PATH_NOT_ATTACHMENT', 'local');
  if (input.expectedBytes > previewMaxBytes) throw new ApiFailure(null, 'PREVIEW_TOO_LARGE', 'local');
  let response: Response;
  try {
    response = await input.fetch(input.path, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'if-match': `"${input.expectedSha256}"` },
      signal: input.signal,
    });
  } catch {
    throw new ApiFailure(null, input.signal?.aborted ? 'ABORTED' : 'NETWORK_UNAVAILABLE', 'transport');
  }
  if (response.status === 401) {
    input.onUnauthorized?.();
    throw new ApiFailure(401, 'UNAUTHENTICATED', 'http');
  }
  if (!response.ok) throw new ApiFailure(response.status, `HTTP_${response.status}`, 'http');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== input.expectedBytes || (await sha256Hex(bytes)) !== input.expectedSha256)
    throw new ApiFailure(response.status, 'HASH_MISMATCH', 'shape');
  if (input.expectedMime === 'text/plain')
    return { blob: new Blob([bytes], { type: 'text/plain' }), mime: 'text/plain' };
  const raster = sniffRaster(new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength)));
  if (!raster || raster !== input.expectedMime)
    throw new ApiFailure(response.status, 'MIME_MISMATCH', 'shape');
  return { blob: new Blob([bytes], { type: raster }), mime: raster };
}

// ---------------------------------------------------------------------------------------------------------
// Extraction presentation

export const extractionLabels: Record<Infer<typeof extractStatus>, string> = {
  pending: 'Đang chờ xử lý',
  running: 'Đang trích xuất',
  complete: 'Đã trích xuất đủ',
  partial: 'Trích xuất một phần',
  encrypted: 'Tệp bị mã hóa',
  corrupt: 'Tệp hỏng',
  unsupported: 'Chưa hỗ trợ định dạng',
  blocked: 'Bị chặn theo chính sách',
  failed: 'Trích xuất thất bại',
};

/** Human description of a coverage locator (page/sheet/cell/span) without trusting unknown shapes. */
export function describeLocator(locator: Record<string, unknown>): string {
  const n = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const s = (value: unknown) => (typeof value === 'string' ? value : null);
  switch (locator.kind) {
    case 'text':
      return `Dòng ${n(locator.lineStart) ?? '?'}–${n(locator.lineEnd) ?? '?'} (byte ${n(locator.byteStart) ?? '?'}–${n(locator.byteEnd) ?? '?'})`;
    case 'pdf':
      return `Trang ${n(locator.page) ?? '?'}`;
    case 'image':
      return `Ảnh ${n(locator.width) ?? '?'}×${n(locator.height) ?? '?'}`;
    case 'docx':
      return n(locator.table) !== null
        ? `Bảng ${n(locator.table)}, hàng ${n(locator.row) ?? '?'}, ô ${n(locator.cell) ?? '?'}`
        : `Đoạn ${n(locator.paragraph) ?? '?'}`;
    case 'sheet':
      return `Trang tính “${s(locator.sheet) ?? '?'}”, vùng ${s(locator.range) ?? '?'}${locator.hidden === true ? ' (ẩn)' : ''}`;
    case 'csv':
      return `Hàng ${n(locator.rowStart) ?? '?'}–${n(locator.rowEnd) ?? '?'}, cột ${n(locator.columnStart) ?? '?'}–${n(locator.columnEnd) ?? '?'}`;
    default:
      return 'Vị trí không xác định';
  }
}

export type CoverageSummary = {
  label: string;
  available: number;
  missing: { id: string; where: string; needs: 'text' | 'vision'; reason: string | null }[];
  verified: boolean;
  /** Derivatives that may be previewed inline (verified only). */
  previewable: Derivative[];
};

/**
 * What was extracted and what is missing. Verified bytes are not “read”: a model reading the input needs a
 * separate receipt, so nothing here says the Assistant or a model has read or understood the file.
 */
export function summarizeExtraction(extraction: Extraction): CoverageSummary {
  return {
    label: extractionLabels[extraction.status],
    available: extraction.units.filter((unit) => unit.state === 'available').length,
    missing: extraction.units
      .filter((unit) => unit.state === 'missing')
      .map((unit) => ({
        id: unit.id,
        where: describeLocator(unit.locator),
        needs: unit.needs,
        reason: unit.reason,
      })),
    verified: extraction.verification === 'verified',
    previewable: extraction.derivatives.filter(
      (derivative) =>
        derivative.verification === 'verified' &&
        derivative.original.attachmentId === extraction.original.attachmentId,
    ),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Comment-scoped refs (G2 projection)

export const decodeCommentAttachmentGroup = obj({
  commentId: uuid,
  attachments: arr(decodeTicketAttachment),
});
export type CommentAttachmentGroup = Infer<typeof decodeCommentAttachmentGroup>;
const decodeCommentAttachmentPage = page(decodeCommentAttachmentGroup);

/**
 * GET `/v2/tickets/:id/attachments/by-comment` (`attachments/comment-refs.ts`): comment-scoped live refs,
 * keyset-paged by commentId. Inherited and route links never appear here, only in the flattened list.
 */
export function commentAttachmentsQuery(client: OwnerClient, ticketId: string) {
  return {
    queryKey: [...attachmentQueryKeys.ticket(ticketId), 'by-comment'] as const,
    queryFn: ({ signal }: { signal?: AbortSignal }): Promise<CommentAttachmentGroup[]> =>
      allPages(
        client,
        `/v2/tickets/${encodeURIComponent(ticketId)}/attachments/by-comment`,
        decodeCommentAttachmentPage,
        signal,
      ),
    retry: false,
  };
}

/**
 * Splits the flattened ticket list into the producer's comment groups and the remaining refs (the ticket's
 * own files or ones inherited from ancestors). Grouping uses only the projection's linkIds.
 */
export function groupTicketAttachments(
  flat: readonly TicketAttachment[],
  groups: readonly CommentAttachmentGroup[],
): { comments: CommentAttachmentGroup[]; other: TicketAttachment[] } {
  const grouped = new Set(groups.flatMap((group) => group.attachments.map((ref) => ref.linkId)));
  return {
    comments: groups.filter((group) => group.attachments.length > 0),
    other: flat.filter((ref) => !grouped.has(ref.linkId)),
  };
}
