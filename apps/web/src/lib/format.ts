import type { AgentRole, EventEnvelope, TicketPriority, TicketStatus, TicketType } from '@crew/shared';
import { ApiRequestError } from './api-client';

/** Every date is shown in the owner's zone (Asia/Saigon). */
export const TIME_ZONE = 'Asia/Ho_Chi_Minh';

export const STATUS_ORDER: readonly TicketStatus[] = [
  'todo',
  'triage',
  'needs_input',
  'in_progress',
  'blocked',
  'in_review',
  'done',
  'cancelled',
];

/** Board columns; cancelled tickets only show in the list. */
export const BOARD_STATUSES: readonly TicketStatus[] = STATUS_ORDER.filter((s) => s !== 'cancelled');

export const STATUS_LABEL: Record<TicketStatus, string> = {
  todo: 'Cần làm',
  triage: 'Đang phân tích',
  needs_input: 'Chờ bạn',
  in_progress: 'Đang làm',
  in_review: 'Review',
  done: 'Xong',
  blocked: 'Bị chặn',
  cancelled: 'Đã hủy',
};

/** Jira lozenge colours: grey todo, blue in progress, green done, yellow needs_input, red blocked. */
export type Tone = 'neutral' | 'progress' | 'done' | 'wait' | 'block';
export const STATUS_TONE: Record<TicketStatus, Tone> = {
  todo: 'neutral',
  triage: 'progress',
  needs_input: 'wait',
  in_progress: 'progress',
  in_review: 'progress',
  done: 'done',
  blocked: 'block',
  cancelled: 'neutral',
};

export const OPEN_STATUSES: readonly TicketStatus[] = STATUS_ORDER.filter(
  (s) => s !== 'done' && s !== 'cancelled',
);
export const isOpen = (status: TicketStatus) => OPEN_STATUSES.includes(status);

export const TYPE_META: Record<TicketType, { letter: string; color: string; label: string }> = {
  request: { letter: 'R', color: '#5e4db2', label: 'Request' },
  pm_task: { letter: 'P', color: '#1d5fd1', label: 'PM task' },
  dev: { letter: 'D', color: '#1f845a', label: 'Dev' },
  qc: { letter: 'Q', color: '#0e7d8f', label: 'QC' },
  bug: { letter: 'B', color: '#c9372c', label: 'Bug' },
  docs_init: { letter: 'I', color: '#a54800', label: 'Khởi tạo docs' },
};
export const TICKET_TYPES = Object.keys(TYPE_META) as TicketType[];

export const ROLE_META: Record<AgentRole, { short: string; color: string; label: string }> = {
  assistant: { short: 'TL', color: '#243b64', label: 'Trợ lý' },
  pm: { short: 'PM', color: '#6b3fb5', label: 'PM agent' },
  dev: { short: 'DEV', color: '#1f845a', label: 'Dev agent' },
  qc: { short: 'QC', color: '#0e7d8f', label: 'QC agent' },
};
export const AGENT_ROLES = Object.keys(ROLE_META) as AgentRole[];

export const PRIORITY_META: Record<TicketPriority, { arrow: string; color: string; label: string }> = {
  urgent: { arrow: '⇈', color: 'var(--red)', label: 'Khẩn cấp' },
  high: { arrow: '↑', color: 'var(--red)', label: 'Cao' },
  medium: { arrow: '→', color: 'var(--orange)', label: 'Trung bình' },
  low: { arrow: '↓', color: 'var(--blue)', label: 'Thấp' },
};
export const PRIORITIES: readonly TicketPriority[] = ['urgent', 'high', 'medium', 'low'];
export const PRIORITY_RANK: Record<TicketPriority, number> = { low: 0, medium: 1, high: 2, urgent: 3 };

const dateTime = new Intl.DateTimeFormat('vi-VN', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const fullDateTime = new Intl.DateTimeFormat('vi-VN', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** `28/09 09:14` in Asia/Saigon. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parts = Object.fromEntries(dateTime.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.day}/${parts.month} ${parts.hour}:${parts.minute}`;
}

export function formatFullDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parts = Object.fromEntries(fullDateTime.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

/** `3 phút trước`, `2 giờ trước`, `hôm qua`, then the date. */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 0) return formatDateTime(iso);
  if (seconds < 60) return 'vừa xong';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  if (hours < 48) return 'hôm qua';
  return formatDateTime(iso);
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `$${value.toFixed(2)}`;
}

const ERROR_TEXT: Partial<Record<string, string>> = {
  REPORT_REQUIRED: 'Ticket cần có report trước khi chuyển sang Xong.',
  ILLEGAL_TRANSITION: 'Không thể chuyển sang trạng thái này.',
  BUDGET_HOLD: 'Ticket đang chờ bạn duyệt vượt giới hạn.',
  UNAUTHORIZED: 'Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.',
  CSRF_FAILED: 'Phiên không hợp lệ, hãy tải lại trang.',
  NOT_FOUND: 'Không tìm thấy.',
  CONFLICT: 'Dữ liệu bị trùng hoặc đã thay đổi.',
  RATE_LIMITED: 'Thử quá nhiều lần, hãy đợi một chút.',
  VALIDATION_FAILED: 'Dữ liệu không hợp lệ.',
  ATTACHMENT_TOO_LARGE: 'Ảnh vượt quá giới hạn 10MB, hãy chọn ảnh nhỏ hơn.',
  TICKET_CLOSED: 'Ticket đã đóng.',
  PM_NOT_AVAILABLE:
    'Không gọi được PM: ticket này không thuộc PM task nào đang mở. Bỏ @pm để gửi bình luận thường.',
  NETWORK: 'Không kết nối được máy chủ.',
  INVALID_RESPONSE: 'Phản hồi từ máy chủ không hợp lệ.',
};

/** Vietnamese message for any error thrown by the API client or elsewhere. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return ERROR_TEXT[error.code] ?? `Lỗi máy chủ (${error.status}).`;
  }
  return 'Đã có lỗi xảy ra.';
}

export function errorCode(error: unknown): string | null {
  return error instanceof ApiRequestError ? error.code : null;
}

const CHANGE_LABEL: Record<string, string> = {
  comment: 'Agent bình luận',
  report: 'Report mới',
  meta: 'Cập nhật lượt chạy agent',
  fields: 'Bạn sửa ticket',
};

const BUDGET_KIND: Record<string, string> = {
  cost: 'chi phí',
  children: 'số ticket con',
  bug_cycles: 'số vòng bug',
  attempts: 'số lần thử',
};

/** One line of the ticket's history timeline. */
export function describeEvent(event: EventEnvelope): string {
  const p = event.payload;
  switch (p.type) {
    case 'ticket.assigned':
      return `Giao cho ${ROLE_META[p.data.role].label}${p.data.reassigned ? ' (chuyển máy)' : ''}`;
    case 'ticket.status_changed':
      return `Trạng thái: ${STATUS_LABEL[p.data.from]} → ${STATUS_LABEL[p.data.to]}`;
    case 'ticket.comment_added':
      return 'Bạn bình luận';
    case 'ticket.pm_mentioned':
      return `Bạn gọi PM (@pm) từ ${p.data.sourceTicketKey}`;
    case 'ticket.updated':
      return CHANGE_LABEL[p.data.change] ?? 'Cập nhật';
    case 'dependency.resolved':
      return 'Ticket phụ thuộc đã xong';
    case 'children.all_done':
      return 'Tất cả ticket con đã đóng';
    case 'ticket.reopened':
      return 'Mở lại';
    case 'ticket.unblocked':
      return 'Bỏ chặn';
    case 'ticket.cancelled':
      return 'Hủy ticket và các ticket con';
    case 'budget.exceeded':
      return `Vượt giới hạn ${BUDGET_KIND[p.data.kind] ?? p.data.kind}`;
    case 'ticket.stuck':
      return `Cảnh báo: đứng yên ${p.data.idleMinutes} phút ở ${STATUS_LABEL[p.data.status]}`;
    default:
      return p.type;
  }
}

export const budgetKindLabel = (kind: string) => BUDGET_KIND[kind] ?? kind;

export const DOCS_STATUS_LABEL: Record<string, string> = {
  unknown: 'chưa rõ',
  missing: 'chưa có docs',
  initializing: 'đang khởi tạo',
  ready: 'sẵn sàng',
};
