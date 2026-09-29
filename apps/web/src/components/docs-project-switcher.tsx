import type { Project } from '@crew/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronDown, Library } from 'lucide-react';
import { cn } from '../lib/cn';
import { DOCS_INDEX, docsHome, docsLinkFor } from '../lib/docs-links';
import { docsSpaceQuery, useDocsOverview, useProjects } from '../lib/queries';
import { ProjectBadge } from './project-badge';
import { MenuContent, MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuTrigger } from './ui/dropdown-menu';

/**
 * Where switching the docs space to `target` lands: the same page when the target's latest snapshot has
 * `currentPath`, else the target's space home. Exported for tests.
 */
export async function switchTarget(
  loadPages: (projectId: string) => Promise<readonly { path: string; flowId: string | null }[]>,
  target: Project,
  currentPath: string | null,
) {
  if (!currentPath) return docsHome(target.key);
  try {
    const page = (await loadPages(target.id)).find((p) => p.path === currentPath);
    return page ? docsLinkFor(target.key, page) : docsHome(target.key);
  } catch {
    // The target space shows its own error or empty state.
    return docsHome(target.key);
  }
}

/**
 * The docs space's project switcher: jumps to another project's docs, keeping the page open now when that
 * project has it, or back to the docs home ("Tất cả dự án"). Each project shows whether it has docs yet.
 */
export function DocsProjectSwitcher({
  project,
  currentPath,
  className,
}: {
  project: Project;
  currentPath: string | null;
  className?: string;
}) {
  const projects = useProjects();
  const overview = useDocsOverview();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const statusOf = new Map((overview.data?.items ?? []).map((item) => [item.projectId, item]));

  const open = async (target: Project) => {
    if (target.id === project.id) return;
    const link = await switchTarget(
      async (id) => (await queryClient.fetchQuery(docsSpaceQuery(id))).pages,
      target,
      currentPath,
    );
    void navigate(link);
  };

  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={`Đổi dự án docs (đang xem ${project.key})`}
          className={cn(
            'flex min-h-11 max-w-full min-w-0 items-center gap-2 rounded border border-line bg-bg px-2.5 text-left text-sm hover:bg-soft xl:min-h-8',
            className,
          )}
        >
          <ProjectBadge projectKey={project.key} className="shrink-0" />
          <span className="min-w-0 truncate font-semibold">{project.name}</span>
          <ChevronDown size={14} aria-hidden className="ml-auto shrink-0" />
        </button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={() => void navigate(DOCS_INDEX)}>
          <Library size={14} aria-hidden /> Tất cả dự án
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Docs theo dự án</MenuLabel>
        {(projects.data ?? []).map((p) => {
          const status = statusOf.get(p.id);
          const ready = status ? status.snapshot !== null : p.docsStatus === 'ready';
          return (
            <MenuItem key={p.id} onSelect={() => void open(p)}>
              <span className="inline-flex w-4 justify-center">
                {p.id === project.id && <Check size={14} aria-label="Đang xem" />}
              </span>
              <span className="font-mono text-xs text-muted">{p.key}</span>
              <span className="min-w-0 grow truncate">{p.name}</span>
              <span className={cn('shrink-0 text-xs', ready ? 'text-muted' : 'text-warn-ink')}>
                {ready ? (status ? `${status.fileCount} file` : 'có docs') : 'chưa có docs'}
              </span>
            </MenuItem>
          );
        })}
      </MenuContent>
    </MenuRoot>
  );
}
