import type { HealthStatus } from '@crew/shared';
import type { ReactNode } from 'react';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'gray';

const TONE: Record<Tone, string> = {
  ok: 'bg-ok-bg text-ok-ink',
  warn: 'bg-warn-bg text-warn-ink',
  bad: 'bg-bad-bg text-bad-ink',
  info: 'bg-accent-bg text-accent-ink',
  gray: 'bg-gray-bg text-gray-ink',
};

export const HEALTH_TONE: Record<HealthStatus, Tone> = { green: 'ok', yellow: 'warn', red: 'bad' };
export const HEALTH_LABEL: Record<HealthStatus, string> = { green: 'Ổn', yellow: 'Cảnh báo', red: 'Lỗi' };

export function Lozenge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

const DOT: Record<HealthStatus, string> = { green: 'bg-ok', yellow: 'bg-warn', red: 'bg-bad' };

export function StatusDot({ status }: { status: HealthStatus }) {
  return (
    <span
      role="img"
      aria-label={HEALTH_LABEL[status]}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT[status]}`}
    />
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded border border-bad-bg bg-bad-bg px-3 py-2 text-sm text-bad-ink">
      {message}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`rounded px-3 py-2 text-sm ${TONE[tone]}`}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        className="h-4 w-4 accent-[var(--blue)]"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
