import type { TicketType } from '@crew/shared';
import { cn } from '../lib/cn';
import { TYPE_META } from '../lib/format';

/** Jira-style square issue-type icon: request, pm_task, dev, qc, bug, docs_init. */
export function TypeIcon({ type, className }: { type: TicketType; className?: string }) {
  const meta = TYPE_META[type];
  return (
    <span
      role="img"
      aria-label={meta.label}
      title={meta.label}
      className={cn(
        'inline-flex size-[18px] shrink-0 items-center justify-center rounded text-[11px] font-bold text-white',
        className,
      )}
      style={{ background: meta.color }}
    >
      {meta.letter}
    </span>
  );
}
