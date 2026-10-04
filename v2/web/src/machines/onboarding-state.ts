/**
 * Shared state helpers of the owner onboarding views (register a machine, create a project, bind a checkout):
 * input rules mirroring the server routes, the machine list query, one-key-per-intent submission through the
 * pending store, and Vietnamese failure texts. Nothing here reads or stores a machine token.
 */
import { useSyncExternalStore } from 'react';
import type { Decoder } from '../contracts/http.ts';
import { decodeMachinePage, type Machine } from '../contracts/machines.ts';
import { ApiFailure, getDecoded, type OwnerClient } from '../lib/api.ts';
import type { PendingOperation, PendingStore, RecoveryTombstone } from '../lib/pending-operation.ts';
import { queryKeys } from '../lib/query-keys.ts';

/** `nameSchema`, `v2/server/src/auth/routes.ts:21`. */
export const machineNameMax = 200;

export function machineNameError(name: string): string | null {
  const value = name.trim();
  if (value.length === 0) return 'Nhập tên máy.';
  if (value.length > machineNameMax) return `Tên máy tối đa ${machineNameMax} ký tự.`;
  return null;
}

const pageLimit = 100;
const maxPages = 50;

/** Every machine (GET `/v2/machines`, `auth/routes.ts:179`), revoked ones included so bindings stay readable. */
export function machinesQueryOptions(client: OwnerClient) {
  return {
    queryKey: queryKeys.machines(),
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<Machine[]> => {
      const items: Machine[] = [];
      let cursor: string | null = null;
      for (let index = 0; index < maxPages; index++) {
        const params = new URLSearchParams({ limit: String(pageLimit) });
        if (cursor) params.set('cursor', cursor);
        const page = await getDecoded(client, `/v2/machines?${params.toString()}`, decodeMachinePage, signal);
        items.push(...page.items);
        if (page.nextCursor === null) return items;
        cursor = page.nextCursor;
      }
      throw new ApiFailure(null, 'MACHINES_TOO_MANY', 'shape');
    },
    retry: false as const,
  };
}

export type IntentRequest = {
  /** Fixed per kind of action (and per target), so at most one unresolved key exists for it. */
  intentId: string;
  method: 'POST' | 'PUT';
  path: string;
  body: unknown;
};

/** Unresolved operation or tombstone of an intent in this tab, live. */
export function useUnresolved(
  pending: PendingStore,
  intentId: string,
): PendingOperation | RecoveryTombstone | undefined {
  return useSyncExternalStore(
    (listener) => pending.subscribe(listener),
    () => pending.unresolved(intentId),
  );
}

/** The held operation (with its frozen payload) of an intent, or null (none, or only a payload-free tombstone). */
export function heldOperation(
  entry: PendingOperation | RecoveryTombstone | undefined,
): PendingOperation | null {
  return entry && 'bodyJson' in entry ? entry : null;
}

/**
 * Sends one intent. No unresolved entry: a new key. A held operation: replayed with its original key, and
 * only when `body` is byte-identical to it. A tombstone: its key is reused with the re-entered body.
 * A confirmed 2xx releases the key; the decoded response is returned to the caller only.
 */
export async function submitIntent<T>(
  pending: PendingStore,
  client: OwnerClient,
  request: IntentRequest,
  decode: Decoder<T>,
): Promise<T> {
  const existing = pending.unresolved(request.intentId);
  let operation: PendingOperation;
  if (!existing) {
    operation = pending.begin({ ...request, storage: 'tab' });
  } else if ('bodyJson' in existing) {
    if (existing.bodyJson !== JSON.stringify(request.body))
      throw new ApiFailure(null, 'INTENT_UNRESOLVED', 'local');
    operation = existing;
  } else {
    operation = pending.resume(existing.id, request.body, 'tab');
  }
  const raw = await client.mutate<unknown>(operation);
  try {
    return decode(raw);
  } catch (error) {
    throw new ApiFailure(
      null,
      'RESPONSE_SHAPE_INVALID',
      'shape',
      error instanceof Error ? error.message : undefined,
    );
  }
}

export type FailureSubject = 'machine' | 'project' | 'binding';

/** Owner-facing reason for a failed onboarding request; the caller keeps every typed field. */
export function onboardingFailureText(error: unknown, subject: FailureSubject): string {
  if (!(error instanceof ApiFailure)) return 'Chưa xác nhận kết quả. Yêu cầu vẫn được giữ để gửi lại.';
  if (error.kind === 'configuration')
    return `Lỗi cấu hình máy chủ (${error.code}). Yêu cầu vẫn giữ khóa cũ; gửi lại sau khi máy chủ được cấu hình.`;
  if (error.code === 'INTENT_UNRESOLVED')
    return 'Đang có yêu cầu cũ chưa xác nhận. Hãy gửi lại đúng yêu cầu cũ trước.';
  if (error.code === 'IDEMPOTENCY_CONFLICT')
    return 'Nội dung khác với yêu cầu cũ chưa xác nhận. Nhập lại đúng nội dung ban đầu để gửi lại.';
  if (['UNAUTHENTICATED', 'SESSION_REQUIRED', 'SESSION_ENDED'].includes(error.code))
    return 'Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục; các trường đã nhập vẫn được giữ.';
  if (error.code === 'ACTIVE_EXECUTION')
    return 'Dự án còn tiến trình đang chạy hoặc chưa được đối chiếu nên chưa đổi máy được. Hãy đối chiếu tác vụ ở trang ticket rồi thử lại; giao diện này không tự dừng, hủy hay kết thúc tác vụ.';
  if (error.code === 'REVISION_CONFLICT')
    return 'Dự án đã được thay đổi ở nơi khác. Đã tải lại thông tin mới nhất; các trường bạn nhập vẫn được giữ. Kiểm tra rồi bấm lại để áp dụng trên bản mới.';
  if (error.code === 'PROJECT_KEY_CONFLICT')
    return 'Mã dự án đã tồn tại. Các trường vẫn được giữ; hãy đổi mã khác.';
  if (error.status === 404)
    return subject === 'binding'
      ? 'Không tìm thấy dự án hoặc máy (máy có thể đã bị thu hồi). Hãy tải lại danh sách.'
      : 'Không tìm thấy đối tượng cần thao tác.';
  if (error.status === 400) return 'Máy chủ từ chối thông tin đã nhập. Kiểm tra lại các trường.';
  if (error.kind === 'transport' || error.kind === 'aborted' || error.code === 'UNCONFIRMED')
    return 'Chưa xác nhận kết quả. Yêu cầu vẫn được giữ nguyên khóa cũ để gửi lại.';
  return `Máy chủ báo lỗi (${error.code}).`;
}

/** Why a list or detail read failed. */
export function readFailureText(error: unknown): string {
  if (error instanceof ApiFailure) {
    if (error.kind === 'transport') return 'Mất kết nối tới máy chủ.';
    if (error.kind === 'shape') return 'Máy chủ trả dữ liệu không đúng định dạng.';
    if (error.code === 'OWNER_NOT_BOOTSTRAPPED')
      return 'Máy chủ chưa khởi tạo chủ dự án. Hoàn tất bước khởi tạo trước.';
    return `Máy chủ báo lỗi (${error.code}).`;
  }
  return 'Đã có lỗi không xác định.';
}
