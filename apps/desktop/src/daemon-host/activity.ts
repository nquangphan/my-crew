import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '@crew/daemon';
import type { JobView, LogLine } from '@crew/shared';
import type { HostContext } from './host-context.js';

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const TAIL_BYTES = 2 * 1024 * 1024;

interface TicketInfo {
  key: string;
  title: string;
}

/** The jobs view and the daemon log (`~/.crew/logs/daemon.log`, JSON lines, one rotation). */
export class Activity {
  private readonly tickets = new Map<string, TicketInfo>();
  readonly logFile: string;

  constructor(private readonly host: HostContext) {
    this.logFile = join(host.paths.logs, 'daemon.log');
  }

  readonly logger: Logger = (level, message, fields = {}) => {
    const jobId = typeof fields.jobId === 'string' ? fields.jobId : null;
    let ticketId = typeof fields.ticketId === 'string' ? fields.ticketId : null;
    if (!ticketId && jobId) ticketId = this.host.daemon?.state.getJob(jobId)?.ticketId ?? null;
    const line: LogLine = {
      at: new Date().toISOString(),
      level,
      message,
      jobId,
      ticketId,
      ticketKey: ticketId ? (this.tickets.get(ticketId)?.key ?? null) : null,
      fields,
    };
    try {
      mkdirSync(this.host.paths.logs, { recursive: true, mode: 0o700 });
      if (existsSync(this.logFile) && statSync(this.logFile).size > MAX_LOG_BYTES) {
        renameSync(this.logFile, `${this.logFile}.1`);
      }
      appendFileSync(this.logFile, `${JSON.stringify(line)}\n`, { mode: 0o600 });
    } catch (error) {
      process.stderr.write(`log write failed: ${(error as Error).message}\n`);
    }
    this.host.deps.emit('log.line', line);
  };

  private async ticket(ticketId: string): Promise<TicketInfo | null> {
    const cached = this.tickets.get(ticketId);
    if (cached) return cached;
    try {
      const { ticket } = await this.host.vps().getTicket(ticketId);
      const info = { key: ticket.key, title: ticket.title };
      this.tickets.set(ticketId, info);
      this.tickets.set(ticket.id, info);
      return info;
    } catch {
      return null;
    }
  }

  /** Running, queued and backoff jobs with the ticket key and title, role, model, times and cost. */
  async jobs(): Promise<JobView[]> {
    const daemon = this.host.daemon;
    if (!daemon) return [];
    const rows = daemon.state.listJobs(['running', 'queued', 'backoff']);
    const views: JobView[] = [];
    for (const job of rows) {
      const info = await this.ticket(job.ticketId);
      views.push({
        id: job.id,
        ticketId: job.ticketId,
        ticketKey: info?.key ?? null,
        ticketTitle: info?.title ?? null,
        status: job.status,
        role: job.role,
        kind: job.kind,
        model: job.model,
        effort: job.effort,
        startedAt: job.startedAt,
        endedAt: job.endedAt,
        retryAt: job.retryAt,
        costUsd: job.costUsd,
        error: job.error,
        webUrl: info ? this.host.webUrl(`/tickets/${info.key}`) : null,
      });
    }
    return views;
  }

  /** The newest `limit` log lines, optionally only those of one ticket (key or id). */
  tail(limit: number, ticket?: string): LogLine[] {
    if (!existsSync(this.logFile)) return [];
    const size = statSync(this.logFile).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    const fd = openSync(this.logFile, 'r');
    try {
      readSync(fd, buffer, 0, buffer.length, start);
    } finally {
      closeSync(fd);
    }
    const wanted = ticket?.trim().toLowerCase() || null;
    const idsForKey = new Set(
      [...this.tickets.entries()].filter(([, info]) => info.key.toLowerCase() === wanted).map(([id]) => id),
    );
    const lines: LogLine[] = [];
    for (const raw of buffer.toString('utf8').split('\n')) {
      if (!raw.startsWith('{')) continue;
      let line: LogLine;
      try {
        line = JSON.parse(raw) as LogLine;
      } catch {
        continue;
      }
      if (
        wanted &&
        line.ticketKey?.toLowerCase() !== wanted &&
        line.ticketId?.toLowerCase() !== wanted &&
        line.jobId?.toLowerCase() !== wanted &&
        !(line.ticketId && idsForKey.has(line.ticketId))
      ) {
        continue;
      }
      lines.push(line);
    }
    return lines.slice(-limit);
  }
}
