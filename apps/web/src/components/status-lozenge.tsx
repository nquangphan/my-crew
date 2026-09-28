import type { TicketPriority, TicketStatus } from '@crew/shared';
import { cn } from '../lib/cn';
import { PRIORITY_META, STATUS_LABEL, STATUS_TONE, type Tone } from '../lib/format';

export const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-neutral-bg text-neutral-ink',
  progress: 'bg-accent-bg text-accent-ink',
  done: 'bg-ok-bg text-ok-ink',
  wait: 'bg-warn-bg text-warn-ink',
  block: 'bg-bad-bg text-bad-ink',
};

/** Jira status lozenge: grey todo, blue in progress, green done, yellow needs_input, red blocked. */
export function StatusLozenge({
  status,
  label,
  className,
}: {
  status: TicketStatus;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-block rounded-[3px] px-1.5 py-0.5 text-[11px] font-bold tracking-[0.02em] whitespace-nowrap uppercase',
        TONE_CLASS[STATUS_TONE[status]],
        className,
      )}
    >
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}

export function PriorityArrow({
  priority,
  withLabel = false,
}: {
  priority: TicketPriority;
  withLabel?: boolean;
}) {
  const meta = PRIORITY_META[priority];
  return (
    <span className="inline-flex items-center gap-1">
      <span
        role="img"
        aria-label={`Ưu tiên ${meta.label}`}
        title={`Ưu tiên ${meta.label}`}
        className="text-sm font-bold"
        style={{ color: meta.color }}
      >
        {meta.arrow}
      </span>
      {withLabel && <span>{meta.label}</span>}
    </span>
  );
}
