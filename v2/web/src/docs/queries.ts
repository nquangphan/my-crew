/**
 * Read-only docs queries (tree, page, search, project docs state, ticket→docs links). Page and search are
 * always pinned to the `snapshotId` of the tree that was read, so bytes of one commit are never shown under
 * another. Every request carries the query's AbortSignal: switching project or snapshot cancels the old GET.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  type DocsPage,
  type DocsTree,
  decodeDocsPage,
  decodeDocsSearchPage,
  decodeDocsTree,
} from '../contracts/docs.ts';
import { type Infer, isUuid, matching, obj, page, str, uuid } from '../contracts/http.ts';
import { decodeProject } from '../contracts/machines.ts';
import { ApiFailure, getDecoded, type OwnerClient } from '../lib/api.ts';
import { queryKeys, queryRoots } from '../lib/query-keys.ts';

export const docsSearchPageLimit = 50;
/** `relatedTicketIds` of tree/page is capped by the producer (`read.ts` `limit 20`). */
export const relatedTicketsCap = 20;
export const ticketDocsLinksPageLimit = 20;

export type DocsSearchFilters = { q: string; projectId: string; snapshotId: string };

function requireUuid(value: string, code: string): string {
  if (!isUuid(value)) throw new ApiFailure(null, code, 'local');
  return value;
}

export function docsTreePath(projectId: string): string {
  return `/v2/projects/${requireUuid(projectId, 'PROJECT_ID_INVALID')}/docs/tree`;
}

export function docsPagePath(projectId: string, snapshotId: string, path: string): string {
  const params = new URLSearchParams({
    snapshotId: requireUuid(snapshotId, 'SNAPSHOT_ID_INVALID'),
    path,
  });
  return `/v2/projects/${requireUuid(projectId, 'PROJECT_ID_INVALID')}/docs/page?${params.toString()}`;
}

/** The cursor is an opaque base64url string produced by the server; it is only echoed back. */
export function docsSearchPath(
  filters: DocsSearchFilters,
  after: string | null,
  limit: number = docsSearchPageLimit,
): string {
  const params = new URLSearchParams({
    q: filters.q,
    projectId: requireUuid(filters.projectId, 'PROJECT_ID_INVALID'),
    snapshotId: requireUuid(filters.snapshotId, 'SNAPSHOT_ID_INVALID'),
  });
  if (after !== null) params.set('after', after);
  params.set('limit', String(limit));
  return `/v2/docs/search?${params.toString()}`;
}

export function useDocsTree(client: OwnerClient, projectId: string) {
  return useQuery({
    queryKey: queryKeys.docsTree(projectId, null),
    queryFn: ({ signal }): Promise<DocsTree> =>
      getDecoded(client, docsTreePath(projectId), decodeDocsTree, signal),
  });
}

export function useDocsPage(
  client: OwnerClient,
  projectId: string,
  snapshotId: string | null,
  path: string | null,
) {
  return useQuery({
    queryKey: queryKeys.docsPage(projectId, snapshotId ?? '', path ?? ''),
    enabled: snapshotId !== null && path !== null,
    queryFn: ({ signal }): Promise<DocsPage> =>
      getDecoded(client, docsPagePath(projectId, snapshotId ?? '', path ?? ''), decodeDocsPage, signal),
  });
}

/**
 * Project docs state (`current`/`stale`/...) comes from the project DTO, not from the HTTP status of a page.
 * It lives under the project's docs prefix so every docs event (`docs.synced`, `docs.imported`) refreshes it
 * together with the tree and pages.
 */
export function docsStateKey(projectId: string) {
  return [...queryRoots.docs(projectId), 'state'] as const;
}

export function useProjectDocsState(client: OwnerClient, projectId: string) {
  return useQuery({
    queryKey: docsStateKey(projectId),
    queryFn: ({ signal }) =>
      getDecoded(
        client,
        `/v2/projects/${requireUuid(projectId, 'PROJECT_ID_INVALID')}`,
        decodeProject,
        signal,
      ),
    select: (project) => project.docsState,
  });
}

export function useDocsSearch(client: OwnerClient, filters: DocsSearchFilters | null) {
  return useInfiniteQuery({
    queryKey: queryKeys.docsSearch(filters ?? { q: '' }),
    enabled: filters !== null && filters.q.trim() !== '',
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      getDecoded(
        client,
        docsSearchPath(filters as DocsSearchFilters, pageParam, docsSearchPageLimit),
        decodeDocsSearchPage,
        signal,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** GET `/v2/tickets/:id/docs-links` (`tickets/history.ts` `readTicketDocsLinks`): opaque cursor, keyset order. */
const decodeTicketDocsLinkPage = page(
  obj({ snapshotId: uuid, path: str }),
  matching(/^[A-Za-z0-9_-]+={0,2}$/, 'opaque cursor'),
);
export type TicketDocsLinkPage = Infer<typeof decodeTicketDocsLinkPage>;

export function ticketDocsLinksPath(ticketId: string, cursor: string | null): string {
  const params = new URLSearchParams();
  if (cursor !== null) params.set('cursor', cursor);
  params.set('limit', String(ticketDocsLinksPageLimit));
  return `/v2/tickets/${requireUuid(ticketId, 'TICKET_ID_INVALID')}/docs-links?${params.toString()}`;
}

export function useTicketDocsLinks(client: OwnerClient, ticketId: string) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.ticket(ticketId), 'docs-links'] as const,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      getDecoded(client, ticketDocsLinksPath(ticketId, pageParam), decodeTicketDocsLinkPage, signal),
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Owner-facing text for a docs read failure. A 422 encoding error is shown, never decoded lossy. */
export function docsFailureText(error: unknown): string {
  if (!(error instanceof ApiFailure)) return 'Đã có lỗi không xác định.';
  if (error.code === 'DOCS_ENCODING_INVALID')
    return 'Trang không phải UTF-8 hợp lệ nên không hiển thị nội dung, để tránh đọc sai hoặc mất dữ liệu.';
  if (error.kind === 'local') return `Trình duyệt không gửi được yêu cầu này (${error.code}).`;
  if (error.kind === 'aborted') return 'Đã hủy tải dữ liệu.';
  if (error.status === 404) return 'Không tìm thấy tài liệu này trong phiên bản đang xem.';
  if (error.kind === 'transport') return 'Mất kết nối tới máy chủ.';
  if (error.kind === 'shape') return 'Máy chủ trả dữ liệu không đúng định dạng.';
  return `Máy chủ báo lỗi (${error.code}).`;
}
