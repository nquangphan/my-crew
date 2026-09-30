import type { HealthStatus, Machine } from '@crew/shared';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronDown, ChevronUp, Hourglass, Plus, TriangleAlert } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { describeWait, formatClock } from '../components/agent-activity';
import { MachineControl } from '../components/machine-control';
import { MachineRuntime, RuntimeReleases } from '../components/machine-runtime';
import { PairingDialog } from '../components/pairing-dialog';
import { ProjectBadge, projectKeyResolver } from '../components/project-badge';
import { ProjectFilterMenu, selectedProjects } from '../components/project-filter';
import { Spinner } from '../components/role-avatar';
import { TONE_CLASS } from '../components/status-lozenge';
import { Button } from '../components/ui/button';
import { DialogContent, DialogRoot } from '../components/ui/dialog';
import { InfoTip } from '../components/ui/info-tip';
import { useToast } from '../components/ui/toast';
import { Breadcrumbs } from '../layout/breadcrumbs';
import { api } from '../lib/api-client';
import { cn } from '../lib/cn';
import { errorMessage, formatFullDateTime, formatRelative, ROLE_META, type Tone } from '../lib/format';
import { keys, useMachine, useMachines, useProjects } from '../lib/queries';
import type { ProjectFilterSearch } from '../lib/search-params';
import { SettingsPickup } from './system-settings';

const HEALTH: Record<HealthStatus, { label: string; tone: Tone }> = {
  green: { label: 'Ổn', tone: 'done' },
  yellow: { label: 'Cảnh báo', tone: 'wait' },
  red: { label: 'Lỗi', tone: 'block' },
};

const TOKEN_WARN_DAYS = 14;

function Lozenge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'rounded-[3px] px-1.5 py-0.5 text-[11px] font-bold whitespace-nowrap uppercase',
        TONE_CLASS[tone],
      )}
    >
      {children}
    </span>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="m-0 text-muted">{label}</dt>
      <dd className="m-0 min-w-0 break-words">{children}</dd>
    </>
  );
}

function Inventory({ machineId }: { machineId: string }) {
  const detail = useMachine(machineId);
  if (detail.isLoading) return <p className="m-0 text-sm text-muted">Đang tải…</p>;
  if (detail.isError) return <p className="m-0 text-sm text-bad">{errorMessage(detail.error)}</p>;
  const inventories = detail.data?.inventories ?? [];
  if (inventories.length === 0)
    return <p className="m-0 text-sm text-muted">Máy chưa gửi danh sách skill.</p>;
  return (
    <div className="flex flex-col gap-3">
      {inventories.map((inv) => (
        <section
          key={inv.projectKey ?? 'machine'}
          aria-label={`Skill ${inv.projectKey ?? 'cấp máy'}`}
          className="flex flex-col gap-1.5"
        >
          <h4 className="m-0 text-[13px] font-semibold">
            {inv.projectKey ? `Dự án ${inv.projectKey}` : 'Cấp máy'}
            <span className="font-normal text-muted"> · cập nhật {formatRelative(inv.updatedAt)}</span>
          </h4>
          <div className="text-[13px]">
            <span className="text-muted">Skill ({inv.skills.length}): </span>
            {inv.skills.length === 0
              ? '—'
              : inv.skills.map((s) => (
                  <span key={s.name} className="mr-1.5 inline-block">
                    <InfoTip
                      label={`Skill ${s.name}`}
                      trigger={<span className="font-mono text-xs text-accent">{s.name}</span>}
                    >
                      <strong className="font-mono">{s.name}</strong> ({s.source})
                      <span className="block">{s.description || 'Không có mô tả.'}</span>
                    </InfoTip>
                  </span>
                ))}
          </div>
          <div className="text-[13px]">
            <span className="text-muted">MCP ({inv.mcpServers.length}): </span>
            {inv.mcpServers.length === 0
              ? '—'
              : inv.mcpServers.map((m) => (
                  <span
                    key={m.name}
                    className={cn(
                      'mr-1.5 inline-block font-mono text-xs',
                      m.status !== 'connected' && 'text-bad',
                    )}
                  >
                    {m.name} ({m.status})
                  </span>
                ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const JOB_KIND: Record<string, string> = {
  agent: 'agent',
  docs_update: 'cập nhật docs',
  docs_init: 'khởi tạo docs',
};

/**
 * One job line: a status mark, the ticket key (linked once known) with its project, and what the job does
 * or waits for.
 */
function JobLine({
  ticketId,
  ticketKey,
  projectKey,
  mark,
  children,
}: {
  ticketId: string;
  ticketKey: string | undefined;
  projectKey: string | undefined;
  mark: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className="flex shrink-0">{mark}</span>
      {ticketKey ? (
        <Link to="/tickets/$ticketKey" params={{ ticketKey }} className="font-mono">
          {ticketKey}
        </Link>
      ) : (
        <span className="font-mono text-muted">{ticketId.slice(0, 8)}</span>
      )}
      {projectKey && <ProjectBadge projectKey={projectKey} />}
      <span className="min-w-0 break-words text-muted">{children}</span>
    </li>
  );
}

/**
 * The machine's running, waiting and failed jobs from its latest heartbeat, with ticket keys, projects and
 * reasons. With a project filter (`projectIds`), only the jobs of those projects are listed (a job whose
 * ticket is still loading stays until its project is known).
 */
function MachineJobs({ machine, projectIds }: { machine: Machine; projectIds: ReadonlySet<string> }) {
  const projects = useProjects();
  const ids = [
    ...new Set([
      ...machine.runningJobs.map((job) => job.ticketId),
      ...machine.waitingJobs.map((job) => job.ticketId),
      ...machine.failedJobs.map((job) => job.ticketId),
    ]),
  ];
  const tickets = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['ticket', id],
      queryFn: () => api.getTicket(id),
      staleTime: 60_000,
    })),
  });
  const ticketOf = (id: string) => tickets[ids.indexOf(id)]?.data?.ticket;
  const keyOf = (id: string) => ticketOf(id)?.key;
  const projectKeyOf = projectKeyResolver(projects.data);
  const projectOf = (id: string) => {
    const ticket = ticketOf(id);
    return ticket ? projectKeyOf(ticket) : undefined;
  };
  const shown = (job: { ticketId: string }) => {
    if (projectIds.size === 0) return true;
    const ticket = ticketOf(job.ticketId);
    return !ticket || (ticket.projectId !== null && projectIds.has(ticket.projectId));
  };
  const running = machine.runningJobs.filter(shown);
  const waiting = machine.waitingJobs.filter(shown);
  const failed = machine.failedJobs.filter(shown);
  if (running.length + waiting.length + failed.length === 0) {
    return <>{ids.length === 0 ? 'Không có' : 'Không có job của dự án đã chọn'}</>;
  }
  return (
    <ul aria-label={`Job trên ${machine.name}`} className="m-0 flex list-none flex-col gap-1 p-0">
      {running.map((job) => (
        <JobLine
          key={`run-${job.ticketId}`}
          ticketId={job.ticketId}
          ticketKey={keyOf(job.ticketId)}
          projectKey={projectOf(job.ticketId)}
          mark={<Spinner label="Đang chạy" />}
        >
          {ROLE_META[job.role].short} · {JOB_KIND[job.kind] ?? job.kind}
          {job.model && ` · ${job.model}${job.effort ? `/${job.effort}` : ''}`}
          {job.startedAt && ` · chạy từ ${formatClock(job.startedAt)}`}
        </JobLine>
      ))}
      {waiting.map((job) => (
        <JobLine
          key={`wait-${job.ticketId}`}
          ticketId={job.ticketId}
          ticketKey={keyOf(job.ticketId)}
          projectKey={projectOf(job.ticketId)}
          mark={<Hourglass size={14} aria-label="Đang chờ" className="text-warn-ink" />}
        >
          {job.role ? `${ROLE_META[job.role].short} · ` : ''}
          {describeWait(
            job.waitReason ?? (job.status === 'backoff' ? 'retry_at' : null),
            job.waitDetail ?? (job.retryAt ? { retryAt: job.retryAt } : null),
          )}
          {job.since && ` · nhận lúc ${formatClock(job.since)}`}
        </JobLine>
      ))}
      {failed.map((job) => (
        <JobLine
          key={`fail-${job.ticketId}`}
          ticketId={job.ticketId}
          ticketKey={keyOf(job.ticketId)}
          projectKey={projectOf(job.ticketId)}
          mark={<TriangleAlert size={14} aria-label="Lỗi" className="text-bad" />}
        >
          {ROLE_META[job.role].short} · lỗi lúc {formatClock(job.failedAt)}: {job.error}
        </JobLine>
      ))}
    </ul>
  );
}

function MachineCard({ machine, projectIds }: { machine: Machine; projectIds: ReadonlySet<string> }) {
  const [expanded, setExpanded] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [confirm, setConfirm] = useState<'revoke' | 'assistant' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const revoked = machine.revokedAt !== null;
  const r = machine.resources;
  const tokenDays = machine.tokenExpiresAt
    ? Math.floor((new Date(machine.tokenExpiresAt).getTime() - Date.now()) / 86_400_000)
    : null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (confirm === 'revoke') await api.revokeMachine(machine.id);
      if (confirm === 'assistant') await api.assignToMachine(machine.id, { hostsAssistant: true });
      toast(confirm === 'revoke' ? `Đã thu hồi ${machine.name}` : `${machine.name} là máy trợ lý`, 'success');
      setConfirm(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.machines }),
        queryClient.invalidateQueries({ queryKey: keys.projects }),
      ]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      aria-label={`Máy ${machine.name}`}
      className={cn(
        'flex flex-col gap-3 rounded-md border border-line bg-panel p-4',
        revoked && 'opacity-60',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden
          className={cn('size-2.5 rounded-full', machine.online && !revoked ? 'bg-ok' : 'bg-muted')}
        />
        <h2 className="m-0 text-base font-semibold">{machine.name}</h2>
        <span className="text-[13px] text-muted">
          {revoked ? 'Đã thu hồi' : machine.online ? 'Trực tuyến' : 'Offline'}
          {machine.online && !machine.streamConnected && !revoked ? ' · chưa mở stream' : ''}
        </span>
        {machine.hostsAssistant && <Lozenge tone="progress">Máy trợ lý</Lozenge>}
        {machine.paused && <Lozenge tone="wait">Tạm dừng</Lozenge>}
        {machine.health && !revoked && (
          <Lozenge tone={HEALTH[machine.health.status].tone}>
            Health: {HEALTH[machine.health.status].label}
          </Lozenge>
        )}
      </div>

      {machine.health && machine.health.failing.length > 0 && !revoked && (
        <ul
          aria-label="Kiểm tra lỗi"
          className="m-0 flex list-none flex-col gap-1 rounded border border-bad bg-bad-bg p-2.5 text-[13px] text-bad-ink"
        >
          {machine.health.failing.map((check) => (
            <li key={check.id}>✗ {check.title}</li>
          ))}
          <li className="text-xs">Sửa bằng “Điều khiển” → “Kiểm tra sức khỏe” ngay trên trang này.</li>
        </ul>
      )}

      <dl className="m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px] md:grid-cols-[130px_minmax(0,1fr)]">
        <Fact label="Máy">{[machine.hostname, machine.os].filter(Boolean).join(' · ') || '—'}</Fact>
        <Fact label="Tài nguyên">
          {r
            ? `CPU ${r.loadAvg1.toFixed(1)}/${r.cpus} · RAM trống ${r.freeMemGb.toFixed(1)}/${r.totalMemGb.toFixed(1)} GB${
                r.diskFreeGb !== undefined ? ` · đĩa trống ${r.diskFreeGb.toFixed(0)} GB` : ''
              }`
            : '—'}
        </Fact>
        <Fact label="Job">
          <MachineJobs machine={machine} projectIds={projectIds} />
        </Fact>
        <Fact label="Dự án">
          {machine.projectKeys.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {machine.projectKeys.map((key) => (
                <ProjectBadge key={key} projectKey={key} />
              ))}
            </span>
          ) : (
            '—'
          )}
        </Fact>
        <Fact label="Phiên bản">
          <MachineRuntime machine={machine} />
          {machine.cliVersion && (
            <span className="text-[13px] text-muted">Claude Code {machine.cliVersion}</span>
          )}
        </Fact>
        <Fact label="Token hết hạn">
          {machine.tokenExpiresAt ? (
            <span className={cn(tokenDays !== null && tokenDays < TOKEN_WARN_DAYS && 'text-bad')}>
              {formatFullDateTime(machine.tokenExpiresAt)} ({tokenDays} ngày)
            </span>
          ) : (
            'Không còn token'
          )}
        </Fact>
        <Fact label="Heartbeat">
          {machine.lastHeartbeatAt ? formatRelative(machine.lastHeartbeatAt) : '—'}
        </Fact>
        {!revoked && (
          <Fact label="Cài đặt">
            <SettingsPickup machine={machine} />
          </Fact>
        )}
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          Skill và MCP{' '}
          {expanded ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        </Button>
        {!revoked && (
          <Button size="sm" onClick={() => setControlling((v) => !v)} aria-expanded={controlling}>
            Điều khiển{' '}
            {controlling ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
          </Button>
        )}
        {!revoked && (
          <Link
            to="/settings/machines/$machineId"
            params={{ machineId: machine.id }}
            className="inline-flex min-h-11 items-center rounded border border-line bg-panel px-2.5 text-[13px] text-ink no-underline hover:bg-soft xl:min-h-7"
          >
            Cài đặt máy
          </Link>
        )}
        {!revoked && !machine.hostsAssistant && (
          <Button size="sm" onClick={() => setConfirm('assistant')}>
            Đặt làm máy trợ lý
          </Button>
        )}
        {!revoked && (
          <Button size="sm" variant="ghost" className="text-bad" onClick={() => setConfirm('revoke')}>
            Thu hồi
          </Button>
        )}
      </div>
      {expanded && <Inventory machineId={machine.id} />}
      {controlling && !revoked && <MachineControl machine={machine} />}

      <DialogRoot open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent
          title={confirm === 'revoke' ? `Thu hồi ${machine.name}?` : `Đặt ${machine.name} làm máy trợ lý?`}
          description={
            confirm === 'revoke'
              ? 'Token của máy bị vô hiệu ngay, stream đóng lại, và máy trả lại các dự án đang giữ.'
              : 'Vai trò trợ lý chuyển sang máy này; request đang mở cũng chuyển theo.'
          }
        >
          {error && (
            <p role="alert" className="m-0 text-sm text-bad">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button onClick={() => setConfirm(null)}>Không</Button>
            <Button
              variant={confirm === 'revoke' ? 'danger' : 'primary'}
              disabled={busy}
              onClick={() => void run()}
            >
              {confirm === 'revoke' ? 'Thu hồi' : 'Xác nhận'}
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>
    </li>
  );
}

/**
 * Machines: online and paused state, desktop-app health with failing checks, resources, jobs, skills, tokens.
 * The "Dự án" filter (`?project=`) keeps the machines holding one of the chosen projects, or running a job
 * of one, and lists only those projects' jobs.
 */
export function MachinesPage({ search = {} }: { search?: ProjectFilterSearch }) {
  const machines = useMachines();
  const projects = useProjects();
  const navigate = useNavigate();
  const [pairing, setPairing] = useState(false);
  const chosen = selectedProjects(projects.data, search.project);
  const chosenIds = new Set(chosen.map((p) => p.id));
  const chosenKeys = new Set(chosen.map((p) => p.key));
  const all = machines.data ?? [];
  const list =
    chosen.length === 0 ? all : all.filter((m) => m.projectKeys.some((key) => chosenKeys.has(key)));
  const hidden = all.length - list.length;
  const active = list.filter((m) => m.revokedAt === null);
  const revoked = list.filter((m) => m.revokedAt !== null);
  return (
    <div className="flex max-w-5xl flex-col gap-4 px-3 py-3 md:px-6 md:py-[18px]">
      <Breadcrumbs items={[{ label: 'Máy' }]} />
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="m-0 grow text-[22px] font-semibold">Máy</h1>
        <ProjectFilterMenu
          projects={projects.data ?? []}
          value={search.project}
          onChange={(project) => void navigate({ to: '/machines', search: { project }, replace: true })}
        />
        <Button variant="primary" onClick={() => setPairing(true)}>
          <Plus size={16} aria-hidden /> Ghép máy mới
        </Button>
      </div>
      {machines.isLoading && <p className="m-0 text-sm text-muted">Đang tải…</p>}
      {machines.isError && (
        <p role="alert" className="m-0 text-sm text-bad">
          {errorMessage(machines.error)}
        </p>
      )}
      {machines.data && active.length === 0 && (
        <p className="m-0 rounded-md border border-line bg-panel p-4 text-sm">
          {chosen.length > 0
            ? `Không máy nào đang giữ ${chosen.map((p) => p.key).join(', ')}.`
            : 'Chưa có máy nào. Bấm “Ghép máy mới” rồi nhập mã trong app 2P Crew.'}
        </p>
      )}
      {chosen.length > 0 && hidden > 0 && (
        <p className="m-0 text-xs text-muted">Ẩn {hidden} máy không giữ dự án đã chọn.</p>
      )}
      <RuntimeReleases />
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {active.map((m) => (
          <MachineCard key={m.id} machine={m} projectIds={chosenIds} />
        ))}
      </ul>
      {revoked.length > 0 && (
        <>
          <h2 className="m-0 text-sm font-semibold text-muted">Đã thu hồi</h2>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {revoked.map((m) => (
              <MachineCard key={m.id} machine={m} projectIds={chosenIds} />
            ))}
          </ul>
        </>
      )}
      <PairingDialog open={pairing} onOpenChange={setPairing} />
    </div>
  );
}
