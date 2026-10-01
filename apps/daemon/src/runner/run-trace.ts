import { isAbsolute, relative, resolve } from 'node:path';
import type { TicketDetailResponse } from '@crew/shared';
import { wrapUntrusted } from '../roles/untrusted-wrap.js';
import type { AbandonReason, JobRow } from '../state-db.js';
import { scrubSecrets } from './secret-scrubber.js';

/** How many of the run's last tool calls a failure comment lists. */
export const TRACE_TOOLS = 5;
/** Characters of the agent's last message a failure comment quotes. */
export const TRACE_MESSAGE_CHARS = 1_500;

export interface TraceStep {
  tool: string;
  /** The file or directory the call touched (repo-relative inside the worktree) or the skill it ran; never a command line. */
  target: string | null;
}

/** What a runner records while the run streams, for the diagnosis of a run that ends badly. */
export interface RunCapture {
  /** `num_turns` added up over the run's results (one per turn), or null without one. */
  numTurns: number | null;
  /** `duration_ms` added up over the run's results (the waits between turns are not counted), or null without one. */
  durationMs: number | null;
  /** Context compactions seen (`system/compact_boundary`). */
  compactions: number;
  /** Text of the main agent's last assistant message (raw; scrubbed when the trace is built). */
  lastMessage: string | null;
  /** The main agent's last tool calls, oldest first, at most `TRACE_TOOLS`. */
  lastTools: TraceStep[];
}

export function emptyCapture(): RunCapture {
  return { numTurns: null, durationMs: null, compactions: 0, lastMessage: null, lastTools: [] };
}

/**
 * What a tool call works on: the skill name of a `Skill` call, else `file_path`, `notebook_path` or `path`
 * (Bash commands and other inputs are left out).
 */
function toolTarget(tool: string, input: unknown, cwd: string): string | null {
  if (!input || typeof input !== 'object') return null;
  const fields = input as Record<string, unknown>;
  if (tool === 'Skill') return typeof fields.skill === 'string' ? fields.skill : null;
  const raw = [fields.file_path, fields.notebook_path, fields.path].find(
    (value): value is string => typeof value === 'string' && value.trim() !== '',
  );
  if (!raw) return null;
  const rel = relative(resolve(cwd), resolve(cwd, raw));
  return rel === '' ? '.' : rel.startsWith('..') || isAbsolute(rel) ? raw : rel;
}

/** Appends one tool call to the capture, keeping only the last `TRACE_TOOLS`. */
export function recordTool(capture: RunCapture, tool: string, input: unknown, cwd: string): void {
  capture.lastTools.push({ tool, target: toolTarget(tool, input, cwd) });
  if (capture.lastTools.length > TRACE_TOOLS) capture.lastTools.shift();
}

/** The diagnosis a job row keeps and a failure comment shows; secrets are already scrubbed. */
export interface RunTrace {
  /** Final result subtype (`success`, `error_max_turns`, …), or null when the run produced none. */
  subtype: string | null;
  numTurns: number | null;
  durationMs: number | null;
  costUsd: number;
  compactions: number;
  lastMessage: string | null;
  /** True when `lastMessage` was cut to `TRACE_MESSAGE_CHARS`. */
  lastMessageTrimmed: boolean;
  lastTools: TraceStep[];
}

const scrub = (text: string) => scrubSecrets(text).text;

export function buildRunTrace(input: {
  capture: RunCapture;
  subtype: string | null;
  costUsd: number;
}): RunTrace {
  const { capture } = input;
  // Scrub before trimming, so a cut cannot split a credential into a prefix the patterns miss.
  const message = capture.lastMessage?.trim() ? scrub(capture.lastMessage.trim()) : null;
  const trimmed = message !== null && message.length > TRACE_MESSAGE_CHARS;
  return {
    subtype: input.subtype,
    numTurns: capture.numTurns,
    durationMs: capture.durationMs,
    costUsd: input.costUsd,
    compactions: capture.compactions,
    lastMessage: trimmed ? `${message.slice(0, TRACE_MESSAGE_CHARS).trimEnd()}…` : message,
    lastMessageTrimmed: trimmed,
    lastTools: capture.lastTools.slice(-TRACE_TOOLS).map((step) => ({
      tool: step.tool,
      target: step.target === null ? null : scrub(step.target),
    })),
  };
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h} giờ ${m} phút`;
  if (m > 0) return `${m} phút ${s} giây`;
  return `${s} giây`;
}

/** "42 lượt · 12 phút 3 giây · 10.0291 USD". */
function numbersLine(trace: RunTrace): string {
  return [
    trace.numTurns === null ? 'không rõ số lượt' : `${trace.numTurns} lượt`,
    trace.durationMs === null ? 'không rõ thời gian' : formatDuration(trace.durationMs),
    `${trace.costUsd.toFixed(4)} USD`,
  ].join(' · ');
}

/** Wraps text as a Markdown quote, keeping its line breaks. */
const quote = (text: string) =>
  text
    .split('\n')
    .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
    .join('\n');

/** Inline code that survives backticks in the value. */
const code = (value: string) => {
  const flat = value.replace(/\s+/g, ' ');
  return flat.includes('`') ? `\`\` ${flat} \`\`` : `\`${flat}\``;
};

/**
 * The compact Markdown block a failure comment ends with: numbers, result, stage, the agent's last message
 * (quoted) and its last tool calls, so the owner can tell from the web why the run stopped.
 */
export function traceMarkdown(trace: RunTrace, stage: string | null): string {
  const facts = [
    `kết quả SDK ${trace.subtype ? code(trace.subtype) : 'không có (lượt chạy không trả kết quả)'}`,
    ...(stage ? [`giai đoạn ${code(stage)}`] : []),
    trace.compactions > 0 ? `context đã bị nén ${trace.compactions} lần` : 'context không bị nén',
  ];
  const lines = [
    `**Số lượt / thời gian / chi phí:** ${numbersLine(trace)}`,
    `**Trạng thái:** ${facts.join(' · ')}`,
    '',
    `**Tin nhắn cuối của agent**${trace.lastMessageTrimmed ? ` (cắt còn ${TRACE_MESSAGE_CHARS} ký tự đầu)` : ''}:`,
    '',
    trace.lastMessage ? quote(trace.lastMessage) : '_(agent không để lại tin nhắn văn bản nào)_',
    '',
    `**Các bước cuối** (${trace.lastTools.length} lệnh gọi tool gần nhất, cũ trước mới sau):`,
    '',
    ...(trace.lastTools.length > 0
      ? trace.lastTools.map(
          (step, index) => `${index + 1}. ${code(step.tool)}${step.target ? ` ${code(step.target)}` : ''}`,
        )
      : ['_(không có lệnh gọi tool nào)_']),
  ];
  return lines.join('\n');
}

/** The heading of the summary a fresh session gets when the run before it was cut short. */
export const FRESH_SESSION_TITLE = '## Phiên mới: lượt chạy trước bị dừng giữa chừng';

/** Comments of the ticket the summary quotes (the newest), and characters kept of each. */
const SUMMARY_COMMENTS = 10;
const SUMMARY_COMMENT_CHARS = 1_500;
const SUMMARY_REPORT_CHARS = 1_000;

const INTERRUPTED_TEXT: Record<AbandonReason, string> = {
  run_started: 'lượt chạy không báo kết quả về daemon (daemon dừng trước khi kịp ghi kết quả)',
  background_tasks: 'phiên đóng khi agent còn tác vụ nền đang chạy (daemon đã dừng các tác vụ đó)',
  aborted: 'lượt chạy bị hủy giữa chừng',
  daemon_stopped: 'daemon dừng giữa lượt chạy',
  no_result: 'tiến trình agent kết thúc mà không trả kết quả',
  daemon_restart: 'daemon tắt đột ngột giữa lượt chạy rồi khởi động lại',
};

/** Why the interrupted run stopped, in words. */
function interruptedText(job: JobRow): string {
  if (job.sessionAbandoned) return INTERRUPTED_TEXT[job.sessionAbandoned];
  if (job.error === 'no_handoff') return 'lượt dev kết thúc mà không gọi `handoff_docs`, ticket bị chặn';
  if (job.error === 'not_finished') return 'lượt chạy kết thúc khi ticket chưa xong, ticket bị chặn';
  if (job.resumeMode) return 'daemon dừng giữa lượt chạy';
  return 'lượt chạy không kết thúc bình thường';
}

/** Scrubbed first, then cut, so a cut cannot split a credential into a prefix the patterns miss. */
function clip(text: string, max: number): string {
  const clean = scrub(text.trim());
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}

/**
 * The note that opens a fresh session started because the run before it was cut short (its session is never
 * resumed): what stopped it, its diagnosis (`traceMarkdown()` of its `run_trace`), the ticket's children,
 * latest comments (the failure diagnoses among them) and current report, and what to do first. Every text
 * the owner did not write is wrapped as untrusted data, and everything is scrubbed of credentials.
 */
export function freshSessionNote(interrupted: JobRow, detail: TicketDetailResponse): string {
  const stage = interrupted.stage ? `, giai đoạn \`${interrupted.stage}\`` : '';
  const trace = interrupted.runTrace
    ? wrapUntrusted(
        'run trace of the interrupted run',
        traceMarkdown(interrupted.runTrace, interrupted.stage),
      )
    : '_(không có chẩn đoán: lượt đó dừng trước khi daemon kịp ghi lại)_';
  const children = detail.children.map(
    (child) => `- ${child.key} [${child.type}, ${child.status}] ${clip(child.title, 300)}`,
  );
  const comments = detail.comments.slice(-SUMMARY_COMMENTS).map((comment) => {
    const body = clip(comment.body, SUMMARY_COMMENT_CHARS);
    if (comment.authorKind === 'owner') return `- (chủ dự án) ${body}`;
    const author = comment.authorRole ? `${comment.authorKind}/${comment.authorRole}` : comment.authorKind;
    return `- (${author})\n${wrapUntrusted(`comment by ${author}`, body)}`;
  });
  return [
    FRESH_SESSION_TITLE,
    '',
    `Đây là một **phiên mới**. Lượt chạy trước của ticket này (job \`${interrupted.id.slice(0, 8)}\`${stage}) bị dừng giữa chừng: ${interruptedText(interrupted)}. Daemon không nối tiếp phiên cũ, nên bạn không có ngữ cảnh của lượt đó ngoài tóm tắt dưới đây.`,
    '',
    '1. Trước tiên chạy `git status` và đọc lại ticket (`get_ticket`) để biết việc nào đã xong.',
    '2. Rồi làm tiếp từ chỗ dừng. Không làm lại việc đã xong; không tạo lại ticket, bình luận hay report đã có.',
    '',
    '### Lượt trước',
    '',
    trace,
    '',
    '### Ticket con hiện có',
    '',
    children.length > 0 ? wrapUntrusted('children of the ticket', children.join('\n')) : '- (chưa có)',
    '',
    '### Bình luận gần nhất',
    '',
    comments.length > 0 ? comments.join('\n') : '- (chưa có)',
    '',
    '### Report hiện tại',
    '',
    detail.report
      ? wrapUntrusted('current report', clip(detail.report.summaryMd, SUMMARY_REPORT_CHARS))
      : '(chưa có)',
  ].join('\n');
}

/** One short line for the heartbeat's failed-job entry (the web shows it next to the ticket). */
export function traceSummary(trace: RunTrace): string {
  const message = trace.lastMessage ? ` · tin nhắn cuối: ${trace.lastMessage.replace(/\s+/g, ' ')}` : '';
  const last = trace.lastTools.at(-1);
  const step = last ? ` · bước cuối: ${last.tool}${last.target ? ` ${last.target}` : ''}` : '';
  return `${numbersLine(trace)}${step}${message}`;
}
