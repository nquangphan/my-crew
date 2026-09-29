import type { Project, Ticket } from '@crew/shared';
import { cn } from '../lib/cn';

/** Resolves a ticket's project key from the loaded projects; requests (no project) get none. */
export function projectKeyResolver(
  projects: readonly Project[] | undefined,
): (ticket: Pick<Ticket, 'projectId'>) => string | undefined {
  const byId = new Map((projects ?? []).map((p) => [p.id, p.key]));
  return (ticket) => (ticket.projectId ? byId.get(ticket.projectId) : undefined);
}

/**
 * The project key on cross-project cards, rows and tree entries. It never grows past its container: in a
 * narrow card or cell it shrinks and ends in an ellipsis (the full key stays in the tooltip).
 */
export function ProjectBadge({ projectKey, className }: { projectKey: string; className?: string }) {
  return (
    <span
      data-project={projectKey}
      title={`Dự án ${projectKey}`}
      className={cn(
        'inline-block min-w-0 max-w-full truncate rounded border border-line bg-soft px-1.5 align-middle font-mono text-[11px] leading-5 text-neutral-ink',
        className,
      )}
    >
      {projectKey}
    </span>
  );
}
