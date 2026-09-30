import {
  HEALTH_GROUP_TITLES,
  type HealthCheckResult,
  HealthReport,
  type HealthStatus,
  JobView,
  LogLine,
  MACHINE_COMMAND_LABEL,
  MACHINE_COMMAND_TIMEOUT_MS,
  type Machine,
  type MachineCommand,
  type MachineCommandRequest,
} from '@crew/shared';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { api } from '../lib/api-client';
import { cn } from '../lib/cn';
import { errorMessage, formatFullDateTime, formatUsd } from '../lib/format';
import { Button } from './ui/button';
import { DialogContent, DialogRoot } from './ui/dialog';
import { Field, Input } from './ui/field';

const FINISHED = new Set<MachineCommand['status']>(['done', 'failed', 'expired']);

/**
 * Sends one whitelisted action to a machine and follows it until the machine reports back (polled every
 * second, up to the action's time limit plus the wait for the machine to take it).
 */
export function useMachineCommand(machineId: string) {
  const [command, setCommand] = useState<MachineCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const run = async (request: MachineCommandRequest): Promise<MachineCommand | null> => {
    setBusy(true);
    setError(null);
    try {
      let current = await api.createMachineCommand(machineId, request);
      setCommand(current);
      const deadline = Date.now() + MACHINE_COMMAND_TIMEOUT_MS[current.action] + 60_000;
      while (alive.current && !FINISHED.has(current.status) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        current = await api.getMachineCommand(machineId, current.id);
        if (alive.current) setCommand(current);
      }
      return current;
    } catch (caught) {
      if (alive.current) setError(errorMessage(caught));
      return null;
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return { command, busy, error, run };
}

const STATUS_TEXT: Record<MachineCommand['status'], string> = {
  pending: 'đang chờ máy nhận…',
  running: 'máy đang làm…',
  done: 'xong',
  failed: 'lỗi',
  expired: 'máy không nhận trong 10 phút (máy tắt hoặc mất mạng)',
};

const HEALTH_TONE: Record<HealthStatus, string> = {
  green: 'text-ok-ink',
  yellow: 'text-warn-ink',
  red: 'text-bad',
};

/**
 * How the web offers a fix: most run on the machine as a remote action; some are pages here (resources,
 * project folders); a few only work at the machine itself (pairing again, the API key help, a host restart).
 */
export function webFixFor(fixId: string): 'remote' | 'settings' | 'machine-only' {
  const [action] = fixId.split(':');
  if (action === 'adjust-limits' || action === 'repick-folder') return 'settings';
  if (action === 'repair' || action === 'api-key-help' || action === 'restart-daemon') return 'machine-only';
  return 'remote';
}

/** The health dashboard as the machine reported it, with the one-click fixes it offers. */
export function HealthReportView({
  report,
  onFix,
  busy,
  machineId,
}: {
  report: HealthReport;
  onFix: (check: HealthCheckResult) => void;
  busy: boolean;
  machineId: string;
}) {
  const groups = [...new Set(report.results.map((item) => item.group))];
  return (
    <section aria-label="Sức khỏe máy" className="flex flex-col gap-2 text-[13px]">
      <p className="m-0 text-muted">Kiểm tra lúc {formatFullDateTime(report.generatedAt)}.</p>
      {groups.map((group) => (
        <section key={group} aria-label={`Nhóm ${HEALTH_GROUP_TITLES[group]}`}>
          <h4 className="m-0 mb-1 text-[13px] font-semibold">{HEALTH_GROUP_TITLES[group]}</h4>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {report.results
              .filter((item) => item.group === group)
              .map((item) => (
                <li
                  key={item.id}
                  data-check={item.id}
                  data-status={item.status}
                  className="flex flex-wrap gap-2"
                >
                  <span className={cn('font-semibold', HEALTH_TONE[item.status])}>
                    {item.status === 'green' ? '✓' : item.status === 'yellow' ? '!' : '✗'} {item.title}
                  </span>
                  <span className="min-w-0 grow break-words text-muted">{item.detail}</span>
                  {item.status !== 'green' && item.fix && webFixFor(item.fix.id) === 'remote' && (
                    <Button size="sm" disabled={busy} onClick={() => onFix(item)}>
                      {item.fix.label}
                    </Button>
                  )}
                  {item.status !== 'green' && item.fix && webFixFor(item.fix.id) === 'settings' && (
                    <Link to="/settings/machines/$machineId" params={{ machineId }} className="text-[13px]">
                      {item.fix.label} (Cài đặt máy)
                    </Link>
                  )}
                  {item.status !== 'green' && item.fix && webFixFor(item.fix.id) === 'machine-only' && (
                    <span className="text-xs text-muted">
                      “{item.fix.label}”: chỉ làm được trên máy (app 2P Crew)
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

function JobsView({ jobs }: { jobs: JobView[] }) {
  if (jobs.length === 0) return <p className="m-0 text-[13px] text-muted">Máy chưa chạy job nào.</p>;
  return (
    <div className="overflow-x-auto">
      <table aria-label="Job trên máy" className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-1 pr-3 font-normal">Ticket</th>
            <th className="py-1 pr-3 font-normal">Trạng thái</th>
            <th className="py-1 pr-3 font-normal">Vai trò</th>
            <th className="py-1 pr-3 font-normal">Model</th>
            <th className="py-1 pr-3 font-normal">Bắt đầu</th>
            <th className="py-1 pr-3 font-normal">Chi phí</th>
            <th className="py-1 font-normal">Lỗi</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id} className="border-t border-line2 align-top">
              <td className="py-1 pr-3">
                {job.ticketKey ? (
                  <Link to="/tickets/$ticketKey" params={{ ticketKey: job.ticketKey }} className="font-mono">
                    {job.ticketKey}
                  </Link>
                ) : (
                  <span className="font-mono text-muted">{job.ticketId.slice(0, 8)}</span>
                )}
              </td>
              <td className="py-1 pr-3">{job.status}</td>
              <td className="py-1 pr-3">
                {job.role} · {job.kind}
              </td>
              <td className="py-1 pr-3">
                {job.model ? `${job.model}${job.effort ? `/${job.effort}` : ''}` : '—'}
              </td>
              <td className="py-1 pr-3 whitespace-nowrap">
                {job.startedAt ? formatFullDateTime(job.startedAt) : '—'}
              </td>
              <td className="py-1 pr-3">{formatUsd(job.costUsd)}</td>
              <td className="py-1 break-words text-bad">{job.error ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LogsView({ lines }: { lines: LogLine[] }) {
  if (lines.length === 0) return <p className="m-0 text-[13px] text-muted">Không có dòng log nào.</p>;
  return (
    <ol
      aria-label="Log của máy"
      className="m-0 flex max-h-96 list-none flex-col overflow-auto rounded border border-line2 p-2 font-mono text-xs"
    >
      {lines.map((line, index) => (
        <li
          // Log lines have no id; their position in this tail is stable while it is shown.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          key={index}
          className={cn(
            'break-words',
            line.level === 'error' ? 'text-bad' : line.level === 'warn' ? 'text-warn-ink' : '',
          )}
        >
          {formatFullDateTime(line.at)} {line.level.toUpperCase()}{' '}
          {line.ticketKey ? `[${line.ticketKey}] ` : ''}
          {line.message}
          {Object.keys(line.fields).length > 0 ? ` ${JSON.stringify(line.fields)}` : ''}
        </li>
      ))}
    </ol>
  );
}

/** What the last finished command returned, shown by its action. */
function CommandResult({
  command,
  onFix,
  busy,
}: {
  command: MachineCommand;
  onFix: (check: HealthCheckResult) => void;
  busy: boolean;
}) {
  if (command.status === 'failed' || command.status === 'expired') {
    return (
      <p role="alert" className="m-0 text-sm text-bad">
        {MACHINE_COMMAND_LABEL[command.action]}: {command.error ?? STATUS_TEXT[command.status]}
      </p>
    );
  }
  if (command.status !== 'done') return null;
  switch (command.action) {
    case 'health.run':
    case 'health.fix': {
      const report = HealthReport.safeParse(command.result);
      return report.success ? (
        <HealthReportView report={report.data} onFix={onFix} busy={busy} machineId={command.machineId} />
      ) : null;
    }
    case 'jobs.list': {
      const jobs = z.array(JobView).safeParse(command.result);
      return jobs.success ? <JobsView jobs={jobs.data} /> : null;
    }
    case 'logs.tail': {
      const lines = z.array(LogLine).safeParse(command.result);
      return lines.success ? <LogsView lines={lines.data} /> : null;
    }
    case 'inventory.refresh': {
      const counts = command.result as { skills: number; mcpServers: number };
      return (
        <p className="m-0 text-sm">
          Đã dò lại: {counts.skills} skill, {counts.mcpServers} MCP server.
        </p>
      );
    }
    default:
      return <p className="m-0 text-sm">{MACHINE_COMMAND_LABEL[command.action]}: xong.</p>;
  }
}

/**
 * Remote control of one machine from the web: pause or resume it, run the health checks and their fixes,
 * re-probe skills and MCP, list its jobs and read its recent log. Only the whitelisted actions exist; the
 * machine runs them and reports back.
 */
export function MachineControl({ machine }: { machine: Machine }) {
  const { command, busy, error, run } = useMachineCommand(machine.id);
  const [limit, setLimit] = useState('200');
  const [ticket, setTicket] = useState('');
  const [releasing, setReleasing] = useState<{ projectKey: string } | { assistant: true } | null>(null);
  const release = () => {
    if (!releasing) return;
    void run(
      'projectKey' in releasing
        ? { action: 'project.release', projectKey: releasing.projectKey }
        : { action: 'assistant.release' },
    );
    setReleasing(null);
  };
  const offline = !machine.online;
  const fix = (check: HealthCheckResult) => {
    if (check.fix) void run({ action: 'health.fix', group: check.group, fixId: check.fix.id });
  };
  const disabled = busy || offline;
  return (
    <section
      aria-label={`Điều khiển ${machine.name}`}
      className="flex flex-col gap-3 rounded border border-line2 p-3"
    >
      {offline && (
        <p className="m-0 text-[13px] text-muted">Máy đang offline: các thao tác chạy khi máy kết nối lại.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {machine.paused ? (
          <Button size="sm" disabled={disabled} onClick={() => void run({ action: 'resume' })}>
            Cho chạy tiếp
          </Button>
        ) : (
          <Button size="sm" disabled={disabled} onClick={() => void run({ action: 'pause' })}>
            Tạm dừng nhận job
          </Button>
        )}
        <Button size="sm" disabled={disabled} onClick={() => void run({ action: 'health.run', quick: true })}>
          Kiểm tra sức khỏe
        </Button>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => void run({ action: 'health.run', quick: false })}
        >
          Kiểm tra đầy đủ
        </Button>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => void run({ action: 'inventory.refresh', projectKey: null })}
        >
          Dò lại skill và MCP
        </Button>
        <Button size="sm" disabled={disabled} onClick={() => void run({ action: 'jobs.list' })}>
          Job gần đây
        </Button>
      </div>
      {(machine.projectKeys.length > 0 || machine.hostsAssistant) && (
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted">Gỡ khỏi máy:</span>
          {machine.projectKeys.map((projectKey) => (
            <Button
              key={projectKey}
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => setReleasing({ projectKey })}
            >
              {projectKey}
            </Button>
          ))}
          {machine.hostsAssistant && (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => setReleasing({ assistant: true })}
            >
              vai trò trợ lý
            </Button>
          )}
        </div>
      )}
      <DialogRoot open={releasing !== null} onOpenChange={(open) => !open && setReleasing(null)}>
        <DialogContent
          title={
            releasing && 'projectKey' in releasing
              ? `Gỡ ${releasing.projectKey} khỏi ${machine.name}?`
              : `Bỏ vai trò trợ lý của ${machine.name}?`
          }
          description="Máy dừng job đang chạy của nó và bỏ các job đang chờ; ticket đang mở chờ máy khác nhận (giao lại ở trang Dự án hoặc Máy)."
        >
          <div className="mt-2 flex justify-end gap-2">
            <Button onClick={() => setReleasing(null)}>Không</Button>
            <Button variant="danger" onClick={release}>
              Gỡ
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const count = Math.min(500, Math.max(1, Number(limit) || 200));
          void run({
            action: 'logs.tail',
            limit: count,
            ...(ticket.trim() ? { ticket: ticket.trim() } : {}),
          });
        }}
      >
        <Field label="Số dòng log" className="w-28">
          <Input type="number" min={1} max={500} value={limit} onChange={(e) => setLimit(e.target.value)} />
        </Field>
        <Field label="Chỉ ticket (key)" className="w-40">
          <Input value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="WEB-12" />
        </Field>
        <Button size="sm" type="submit" disabled={disabled}>
          Xem log
        </Button>
      </form>
      {command && (
        <p aria-live="polite" className="m-0 text-[13px] text-muted">
          {MACHINE_COMMAND_LABEL[command.action]}: {STATUS_TEXT[command.status]}
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 text-sm text-bad">
          {error}
        </p>
      )}
      {command && <CommandResult command={command} onFix={fix} busy={disabled} />}
    </section>
  );
}
