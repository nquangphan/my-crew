import type { HealthStatus, Machine } from '@crew/shared';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { PairingDialog } from '../components/pairing-dialog';
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
import { keys, useMachine, useMachines } from '../lib/queries';

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

function RunningJobs({ machine }: { machine: Machine }) {
  const tickets = useQueries({
    queries: machine.runningJobs.map((job) => ({
      queryKey: ['ticket', job.ticketId],
      queryFn: () => api.getTicket(job.ticketId),
      staleTime: 60_000,
    })),
  });
  if (machine.runningJobs.length === 0) return <>Không có</>;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {machine.runningJobs.map((job, i) => {
        const key = tickets[i]?.data?.ticket.key;
        return (
          <li key={`${job.ticketId}-${job.kind}`} className="flex items-center gap-1.5">
            <Spinner label="Đang chạy" />
            {key ? (
              <Link to="/tickets/$ticketKey" params={{ ticketKey: key }} className="font-mono">
                {key}
              </Link>
            ) : (
              <span className="font-mono text-muted">{job.ticketId.slice(0, 8)}</span>
            )}
            <span className="text-muted">
              {ROLE_META[job.role].short} · {job.kind}
              {job.startedAt && ` · từ ${formatRelative(job.startedAt)}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function MachineCard({ machine }: { machine: Machine }) {
  const [expanded, setExpanded] = useState(false);
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
          <li className="text-xs">Sửa bằng nút “Sửa” trên bảng health của app 2P Crew trên máy này.</li>
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
        <Fact label="Job đang chạy">
          <RunningJobs machine={machine} />
        </Fact>
        <Fact label="Dự án">
          {machine.projectKeys.length > 0 ? (
            <span className="font-mono">{machine.projectKeys.join(', ')}</span>
          ) : (
            '—'
          )}
        </Fact>
        <Fact label="Phiên bản">
          {[
            machine.appVersion && `app ${machine.appVersion}`,
            machine.cliVersion && `crewd ${machine.cliVersion}`,
          ]
            .filter(Boolean)
            .join(' · ') || '—'}
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
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          Skill và MCP{' '}
          {expanded ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        </Button>
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

/** Machines: online and paused state, desktop-app health with failing checks, resources, jobs, skills, tokens. */
export function MachinesPage() {
  const machines = useMachines();
  const [pairing, setPairing] = useState(false);
  const list = machines.data ?? [];
  const active = list.filter((m) => m.revokedAt === null);
  const revoked = list.filter((m) => m.revokedAt !== null);
  return (
    <div className="flex max-w-5xl flex-col gap-4 px-3 py-3 md:px-6 md:py-[18px]">
      <Breadcrumbs items={[{ label: 'Máy' }]} />
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="m-0 grow text-[22px] font-semibold">Máy</h1>
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
          Chưa có máy nào. Bấm “Ghép máy mới” rồi nhập mã trong app 2P Crew.
        </p>
      )}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {active.map((m) => (
          <MachineCard key={m.id} machine={m} />
        ))}
      </ul>
      {revoked.length > 0 && (
        <>
          <h2 className="m-0 text-sm font-semibold text-muted">Đã thu hồi</h2>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {revoked.map((m) => (
              <MachineCard key={m.id} machine={m} />
            ))}
          </ul>
        </>
      )}
      <PairingDialog open={pairing} onOpenChange={setPairing} />
    </div>
  );
}
