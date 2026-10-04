/**
 * Pure ticket view-model helpers shared by board, list, graph and the ticket dialog. Status and hierarchy
 * come only from producer fields (`status`, `level`, `id`, `rootId`, `parentId`); titles or page position
 * never decide whether a ticket is a request root.
 */
import { newerTicket, type Ticket, type TicketStatus } from '../contracts/tickets.ts';

export const statusLabels = {
  pending: 'Chờ thực hiện',
  ready: 'Sẵn sàng',
  running: 'Đang chạy',
  needs_input: 'Chờ bạn',
  paused: 'Tạm dừng',
  done: 'Hoàn thành',
  cancelled: 'Đã hủy',
} as const satisfies Record<TicketStatus, string>;

/** Board column order: the producer lifecycle from waiting to terminal. */
export const statusOrder: readonly TicketStatus[] = [
  'pending',
  'ready',
  'running',
  'needs_input',
  'paused',
  'done',
  'cancelled',
];

/** Text icon shown next to the label, so status never relies on colour alone. */
export const statusIcons: Readonly<Record<TicketStatus, string>> = {
  pending: '○',
  ready: '◔',
  running: '▶',
  needs_input: '?',
  paused: '‖',
  done: '✓',
  cancelled: '✕',
};

export const levelLabels = { request: 'Yêu cầu', step: 'Bước', task: 'Công việc' } as const satisfies Record<
  Ticket['level'],
  string
>;
export const kindLabels = {
  code: 'Lập trình',
  research: 'Nghiên cứu',
  docs: 'Tài liệu',
  deploy: 'Triển khai',
} as const satisfies Record<Ticket['kind'], string>;

export function isTerminal(status: TicketStatus): boolean {
  return status === 'done' || status === 'cancelled';
}

/** Dedupe by ID keeping the highest revision; first-seen order is preserved. */
export function mergeTicketPages(pages: readonly (readonly Ticket[])[]): Ticket[] {
  const rows = new Map<string, Ticket>();
  for (const page of pages) for (const row of page) rows.set(row.id, newerTicket(rows.get(row.id), row));
  return [...rows.values()];
}

/** Request roots by producer hierarchy only: `level==='request' && id===rootId && parentId===null`. */
export function requestRoots(tickets: readonly Ticket[]): Ticket[] {
  return mergeTicketPages([tickets]).filter(
    (row) => row.level === 'request' && row.id === row.rootId && row.parentId === null,
  );
}

export function groupByStatus(tickets: readonly Ticket[]): Record<TicketStatus, Ticket[]> {
  const groups = Object.fromEntries(statusOrder.map((status) => [status, [] as Ticket[]])) as Record<
    TicketStatus,
    Ticket[]
  >;
  for (const row of tickets) groups[row.status].push(row);
  return groups;
}

export type Focusable = { readonly isConnected: boolean; focus(): void };

/** First candidate still attached to the document: trigger, then its view container, then main. */
export function pickReturnFocus<T extends Focusable>(candidates: readonly (T | null)[]): T | null {
  return candidates.find((candidate): candidate is T => candidate?.isConnected === true) ?? null;
}

/**
 * Codes the producer writes: `server/src/tickets/service.ts:420,486` (`owner_input`, `repair_limit`),
 * `server/src/tickets/repair.ts:54`, `server/src/execution/attempts.ts:489`.
 */
const waitReasonLabels: Readonly<Record<string, string>> = {
  owner_input: 'Cần bạn trả lời hoặc quyết định.',
  repair_limit: 'Đã sửa đủ 5 vòng nhưng vẫn chưa đạt, cần bạn quyết định.',
  final_result_pending: 'Máy chưa xác nhận kết quả cuối.',
};

/** Label for the producer's `waitReason` code; an unknown code is shown verbatim, never reinterpreted. */
export function waitReasonLabel(reason: string): string {
  return waitReasonLabels[reason] ?? `mã từ máy chủ “${reason}”.`;
}

/**
 * Wait notice for the detail view. `waitReason` is shown whenever the producer set it, whatever the status
 * (`final_result_pending` is written without moving the ticket to `needs_input`); “Đang chờ bạn” is said
 * only for `needs_input`, and the reason is introduced neutrally so the two never contradict each other.
 */
export function waitNotice(status: TicketStatus, reason: string | null): string | null {
  const why = reason === null ? null : `Lý do chờ: ${waitReasonLabel(reason)}`;
  if (status === 'needs_input') return `Đang chờ bạn. ${why ?? 'Máy chủ chưa ghi lý do.'}`;
  return why;
}
