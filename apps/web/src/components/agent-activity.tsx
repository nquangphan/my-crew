import {
  AGENT_ACTIVITY_STALE_MS,
  type AgentActivity,
  type JobWaitDetail,
  type JobWaitReason,
  type Ticket,
} from '@crew/shared';
import { CircleHelp, Hourglass, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../lib/cn';
import { formatDateTime, formatRelative, TIME_ZONE, type Tone } from '../lib/format';
import { Spinner } from './role-avatar';
import { TONE_CLASS } from './status-lozenge';

const clockFormat = new Intl.DateTimeFormat('vi-VN', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE });

/** `11:32` today (Asia/Saigon), `28/09 11:32` on another day. */
export function formatClock(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  if (dayFormat.format(date) !== dayFormat.format(new Date(now))) return formatDateTime(iso);
  const parts = Object.fromEntries(clockFormat.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.hour}:${parts.minute}`;
}

const num = (value: number) => String(Number(value.toFixed(1)));

/** Why a held job waits, in the owner's words (no machine name). */
export function describeWait(
  reason: JobWaitReason | null | undefined,
  detail: JobWaitDetail | null | undefined,
  now = Date.now(),
): string {
  const d = detail ?? {};
  switch (reason) {
    case 'no_slots': {
      const facts: string[] = [];
      if (d.loadAvg1 !== undefined && d.maxLoad !== undefined && d.loadAvg1 > d.maxLoad) {
        facts.push(`tải ${num(d.loadAvg1)}/${num(d.maxLoad)}`);
      }
      if (d.freeMemGb !== undefined && d.minFreeMemGb !== undefined && d.freeMemGb < d.minFreeMemGb) {
        facts.push(`RAM trống ${num(d.freeMemGb)}/${num(d.minFreeMemGb)} GB`);
      }
      if (d.slots !== undefined) {
        const free = Math.max(0, d.slots - (d.runningJobs ?? 0));
        facts.push(
          facts.length === 0 && d.slots > 0
            ? `đã chạy đủ ${d.runningJobs ?? d.slots}/${d.slots} job`
            : `${free} slot trống`,
        );
      }
      return `đang chờ slot — máy bận${facts.length > 0 ? ` (${facts.join(', ')})` : ''}`;
    }
    case 'waiting_deps':
      return d.dependsOn && d.dependsOn.length > 0
        ? `chờ ${d.dependsOn.join(', ')} xong`
        : 'chờ ticket phụ thuộc xong';
    case 'project_not_here':
      return `dự án${d.projectKey ? ` ${d.projectKey}` : ''} chưa thuộc máy này`;
    case 'no_local_folder':
      return `máy chưa có thư mục dự án${d.projectKey ? ` ${d.projectKey}` : ''}`;
    case 'not_assistant_host':
      return 'máy không còn là máy trợ lý';
    case 'over_budget':
      return 'chờ bạn duyệt vượt ngân sách';
    case 'paused':
      return 'máy đang tạm dừng, chờ bạn bật lại';
    case 'retry_at':
      return d.retryAt ? `chờ thử lại lúc ${formatClock(d.retryAt, now)}` : 'chờ thử lại';
    case 'check_failed':
      return `chưa kiểm tra được để chạy${d.message ? `: ${d.message}` : ''}`;
    default:
      return 'đang xếp hàng';
  }
}

export interface ActivityView {
  kind: 'running' | 'waiting' | 'failed' | 'unknown';
  tone: Tone;
  text: string;
}

/**
 * One line about what an agent machine is doing with the ticket, or null when no agent is expected on
 * it. A running or waiting report whose heartbeat is older than AGENT_ACTIVITY_STALE_MS reads as unknown
 * (the server says so too; this covers the time until the next refetch).
 */
export function describeActivity(
  ticket: Pick<Ticket, 'type' | 'agentActivity'>,
  now = Date.now(),
): ActivityView | null {
  const a: AgentActivity | null | undefined = ticket.agentActivity;
  if (!a) return null;
  const machine = a.machineName ?? 'Máy';
  const stale =
    (a.status === 'running' || a.status === 'queued' || a.status === 'backoff') &&
    (!a.reportedAt || now - Date.parse(a.reportedAt) > AGENT_ACTIVITY_STALE_MS);
  if (a.status === 'unknown' || stale) {
    return {
      kind: 'unknown',
      tone: 'neutral',
      text: `Không rõ — ${machine} mất liên lạc${a.reportedAt ? ` (báo lần cuối ${formatRelative(a.reportedAt, now)})` : ''}`,
    };
  }
  switch (a.status) {
    case 'running': {
      const model = a.model ? ` · ${a.model}${a.effort ? `/${a.effort}` : ''}` : '';
      // The server settings revision (prompts, rules, model map) the run started with.
      const settings = a.settingsRevision ? ` · cài đặt ${a.settingsRevision}` : '';
      const since = a.since ? ` · từ ${formatClock(a.since, now)}` : '';
      return {
        kind: 'running',
        tone: 'progress',
        text: `Đang chạy trên ${machine}${model}${settings}${since}`,
      };
    }
    case 'queued':
    case 'backoff': {
      const reason = a.waitReason ?? (a.status === 'backoff' ? 'retry_at' : null);
      const wait = describeWait(reason, a.waitDetail, now);
      const text =
        reason === 'waiting_deps' || reason === 'retry_at' || reason === 'over_budget'
          ? `${wait.charAt(0).toUpperCase()}${wait.slice(1)}`
          : `${machine} đã nhận, ${wait}`;
      return { kind: 'waiting', tone: 'wait', text };
    }
    case 'failed':
      return {
        kind: 'failed',
        tone: 'block',
        text: `Lỗi khi chạy trên ${machine}${a.waitDetail?.message ? `: ${a.waitDetail.message}` : ''}`,
      };
    case 'unreported': {
      const host = ticket.type === 'request' ? 'máy trợ lý' : 'máy dự án';
      const why = !a.machineName
        ? `chưa có ${host}`
        : a.machineOnline
          ? `${host} ${a.machineName} chưa báo nhận`
          : `${host} ${a.machineName} offline`;
      return { kind: 'waiting', tone: 'wait', text: `Chưa máy nào nhận (${why})` };
    }
    default:
      return null;
  }
}

/** Re-renders every `ms`, so relative times and staleness stay current without a refetch. */
function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

function ActivityIcon({ view }: { view: ActivityView }) {
  if (view.kind === 'running') return <Spinner label="Agent đang chạy" />;
  const Icon = view.kind === 'failed' ? TriangleAlert : view.kind === 'unknown' ? CircleHelp : Hourglass;
  return <Icon size={14} aria-hidden className="shrink-0" />;
}

/** The ticket view's activity line (side panel and full page, every viewport). */
export function AgentActivityLine({ ticket }: { ticket: Pick<Ticket, 'type' | 'agentActivity'> }) {
  const now = useNow();
  const view = describeActivity(ticket, now);
  if (!view) return null;
  return (
    <div
      role="status"
      aria-label="Hoạt động của agent"
      data-activity={view.kind}
      className={cn(
        'flex items-start gap-2 rounded-md px-3 py-2 text-[13px] leading-snug break-words',
        TONE_CLASS[view.tone],
      )}
    >
      <span className="mt-0.5 flex shrink-0">
        <ActivityIcon view={view} />
      </span>
      <span className="min-w-0">{view.text}</span>
    </div>
  );
}

/** A board card's small waiting, failed or unknown mark (running shows as the avatar spinner). */
export function AgentActivityMark({ ticket }: { ticket: Pick<Ticket, 'type' | 'agentActivity'> }) {
  const view = describeActivity(ticket);
  if (!view || view.kind === 'running') return null;
  return (
    <span
      role="img"
      aria-label={view.text}
      title={view.text}
      data-activity={view.kind}
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-full',
        view.kind === 'failed' ? 'text-bad' : view.kind === 'unknown' ? 'text-muted' : 'text-warn-ink',
      )}
    >
      <ActivityIcon view={view} />
    </span>
  );
}
