import { Link, useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import {
  BookOpen,
  ChevronDown,
  FolderKanban,
  Inbox,
  KanbanSquare,
  Layers,
  Library,
  List,
  type LucideIcon,
  Monitor,
  Send,
  Settings,
} from 'lucide-react';
import { useEffect } from 'react';
import {
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from '../components/ui/dropdown-menu';
import { cn } from '../lib/cn';
import { useMachines, useProjects } from '../lib/queries';
import { useStoredState } from '../lib/ui-state';
import { CURRENT_PROJECT_KEY } from './shell-context';

/** The project the sidebar and the `g b`/`g l`/`g d` shortcuts use: the URL's, else the last one, else the first. */
export function useCurrentProjectKey(): string | undefined {
  const params = useParams({ strict: false }) as { projectKey?: string };
  const [stored, setStored] = useStoredState<string | null>(CURRENT_PROJECT_KEY, null);
  const projects = useProjects();
  useEffect(() => {
    if (params.projectKey && params.projectKey !== stored) setStored(params.projectKey);
  }, [params.projectKey, stored, setStored]);
  const known = (key: string | null | undefined) =>
    key && (projects.data === undefined || projects.data.some((p) => p.key === key)) ? key : undefined;
  return known(params.projectKey) ?? known(stored) ?? projects.data?.[0]?.key;
}

/** The per-project pages; switching project keeps the one open now. */
const PROJECT_SECTIONS = {
  board: '/projects/$projectKey/board',
  list: '/projects/$projectKey/list',
  docs: '/projects/$projectKey/docs',
  settings: '/projects/$projectKey/settings',
} as const;

/** The project page open at `path` (`/projects/KEY/list` → `list`), or the board elsewhere. */
export function projectSectionOf(path: string): keyof typeof PROJECT_SECTIONS {
  const match = /^\/projects\/[^/]+\/(board|list|docs|settings)\/?$/.exec(path);
  return (match?.[1] as keyof typeof PROJECT_SECTIONS | undefined) ?? 'board';
}

interface NavEntry {
  label: string;
  icon: LucideIcon;
  to: string;
  params?: Record<string, string>;
  match: (path: string) => boolean;
}

/**
 * Jira-like project sidebar. `mode`: `full` (desktop and the open drawer), `rail` (tablet icon rail).
 */
export function ProjectSidebar({
  mode,
  onNavigate,
  onExpand,
}: {
  mode: 'full' | 'rail';
  onNavigate?: () => void;
  onExpand?: () => void;
}) {
  const projectKey = useCurrentProjectKey();
  const projects = useProjects();
  const machines = useMachines();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const project = projects.data?.find((p) => p.key === projectKey);
  const owner = machines.data?.find((m) => m.id === project?.ownerMachineId);
  const rail = mode === 'rail';

  const projectNav: NavEntry[] = projectKey
    ? [
        {
          label: 'Board',
          icon: KanbanSquare,
          to: '/projects/$projectKey/board',
          params: { projectKey },
          match: (p) => p.startsWith('/projects/') && p.endsWith('/board'),
        },
        {
          label: 'Danh sách',
          icon: List,
          to: '/projects/$projectKey/list',
          params: { projectKey },
          match: (p) => p.startsWith('/projects/') && p.endsWith('/list'),
        },
        {
          label: 'Docs',
          icon: BookOpen,
          to: '/projects/$projectKey/docs',
          params: { projectKey },
          match: (p) => p.startsWith('/projects/') && p.endsWith('/docs'),
        },
        {
          label: 'Cài đặt project',
          icon: Settings,
          to: '/projects/$projectKey/settings',
          params: { projectKey },
          match: (p) => p.endsWith('/settings'),
        },
      ]
    : [];
  const manageNav: NavEntry[] = [
    { label: 'Inbox', icon: Inbox, to: '/inbox', match: (p) => p === '/inbox' },
    { label: 'Dự án', icon: FolderKanban, to: '/projects', match: (p) => p === '/projects' },
    { label: 'Máy', icon: Monitor, to: '/machines', match: (p) => p === '/machines' },
  ];

  const item = (entry: NavEntry) => {
    const active = entry.match(path);
    const Icon = entry.icon;
    return (
      <Link
        key={entry.label}
        to={entry.to}
        params={entry.params}
        onClick={onNavigate}
        aria-label={rail ? entry.label : undefined}
        title={rail ? entry.label : undefined}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-h-11 items-center gap-2.5 rounded px-2.5 text-sm text-neutral-ink no-underline hover:bg-soft xl:min-h-9',
          active && 'bg-accent-bg font-semibold text-accent',
          rail && 'justify-center px-0',
        )}
      >
        <Icon size={18} aria-hidden />
        {!rail && entry.label}
      </Link>
    );
  };

  const section = (label: string) =>
    rail ? (
      <div className="my-2 h-px bg-line2" />
    ) : (
      <div className="px-2.5 pt-3.5 pb-1 text-[11px] font-bold tracking-[0.06em] text-muted uppercase">
        {label}
      </div>
    );

  return (
    <nav
      aria-label="Điều hướng dự án"
      className={cn(
        'flex h-full shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-panel py-4',
        rail ? 'w-14 items-stretch px-1.5' : 'w-[232px] px-3',
      )}
    >
      {rail ? (
        <button
          type="button"
          onClick={onExpand}
          aria-label="Mở rộng thanh bên"
          title={project ? `${project.name} (mở rộng)` : 'Mở rộng thanh bên'}
          className="mb-3 inline-flex size-11 items-center justify-center rounded-md bg-accent-bg text-[13px] font-bold text-accent"
        >
          {project?.key.slice(0, 2) ?? '2P'}
        </button>
      ) : (
        <MenuRoot>
          <MenuTrigger asChild>
            <button
              type="button"
              className="mb-3 flex min-h-11 items-center gap-2.5 rounded px-2 text-left hover:bg-soft"
              aria-label="Chọn dự án"
            >
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-bg text-[13px] font-bold text-accent">
                {project?.key.slice(0, 2) ?? '—'}
              </span>
              <span className="min-w-0 grow">
                <span className="flex items-center gap-1 truncate text-sm font-semibold">
                  {project?.name ?? 'Chưa có dự án'} <ChevronDown size={14} aria-hidden />
                </span>
                <span className="block truncate text-xs text-muted">
                  {project ? `Máy: ${owner?.name ?? 'chưa có'}` : 'Tạo dự án trong mục Dự án'}
                </span>
              </span>
            </button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem
              onSelect={() => {
                onNavigate?.();
                void navigate({ to: '/board' });
              }}
            >
              <Layers size={14} aria-hidden /> Tất cả dự án
            </MenuItem>
            <MenuSeparator />
            <MenuLabel>Dự án</MenuLabel>
            {(projects.data ?? []).map((p) => (
              <MenuItem
                key={p.id}
                onSelect={() => {
                  onNavigate?.();
                  void navigate({
                    to: PROJECT_SECTIONS[projectSectionOf(path)],
                    params: { projectKey: p.key },
                  });
                }}
              >
                <span className="font-mono text-xs text-muted">{p.key}</span> {p.name}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem
              onSelect={() => {
                onNavigate?.();
                void navigate({ to: '/projects' });
              }}
            >
              Quản lý dự án
            </MenuItem>
          </MenuContent>
        </MenuRoot>
      )}
      {item({
        label: 'Tất cả dự án',
        icon: Layers,
        to: '/board',
        match: (p) => p === '/board' || p === '/list',
      })}
      {item({
        label: 'Tất cả request của tôi',
        icon: Send,
        to: '/requests',
        match: (p) => p === '/requests',
      })}
      {item({ label: 'Tài liệu', icon: Library, to: '/docs', match: (p) => p === '/docs' })}
      {projectNav.length > 0 && section('Dự án')}
      {projectNav.map(item)}
      {section('Quản lý')}
      {manageNav.map(item)}
      {!rail && project && (
        <div className="mt-auto flex items-center gap-2 border-t border-line2 px-2.5 pt-2.5 text-xs text-muted">
          <span
            className={cn('size-2 shrink-0 rounded-full', owner?.online ? 'bg-ok' : 'bg-muted')}
            aria-hidden
          />
          {owner
            ? `${owner.name} · ${owner.online ? `${owner.runningJobs.length} job đang chạy` : 'offline'}`
            : 'Dự án chưa có máy'}
        </div>
      )}
    </nav>
  );
}
