import type { AgentRole } from '@crew/shared';
import { cn } from '../lib/cn';
import { ROLE_META } from '../lib/format';

/** Round assignee avatar (TL, PM, DEV, QC); `running` adds a spinner while an agent job runs. */
export function RoleAvatar({
  agent,
  size = 26,
  running = false,
  className,
}: {
  agent: AgentRole;
  size?: number;
  running?: boolean;
  className?: string;
}) {
  const meta = ROLE_META[agent];
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1', className)}>
      {running && <Spinner label="Agent đang chạy" />}
      <span
        role="img"
        aria-label={meta.label}
        title={meta.label}
        className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
        style={{
          width: size,
          height: size,
          background: meta.color,
          fontSize: Math.max(9, Math.round(size * 0.36)),
        }}
      >
        {meta.short}
      </span>
    </span>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className="inline-block size-3 rounded-full border-2 border-accent-bg border-t-accent"
      style={{ animation: 'crew-spin 1s linear infinite' }}
    />
  );
}
