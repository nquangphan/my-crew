import { useQueryClient } from '@tanstack/react-query';
import {
  Link,
  Outlet,
  useNavigate,
  useParams,
  useRouteContext,
  useRouter,
  useRouterState,
} from '@tanstack/react-router';
import { Bell, Keyboard, LogOut, Menu, Moon, Plus, Search, Sun, UserCog } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NewTicketDialog } from '../components/new-ticket-dialog';
import { Button } from '../components/ui/button';
import { DialogContent, DialogRoot } from '../components/ui/dialog';
import {
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from '../components/ui/dropdown-menu';
import { api, setCsrfToken } from '../lib/api-client';
import { cn } from '../lib/cn';
import { DOCS_INDEX, docsHome } from '../lib/docs-links';
import { useInboxSummary } from '../lib/inbox';
import { startLiveEvents } from '../lib/live-events';
import { keys, sessionQuery } from '../lib/queries';
import { SHORTCUT_HELP, useShortcuts } from '../lib/shortcuts';
import { useTheme, useViewport } from '../lib/ui-state';
import { ProjectSidebar, useCurrentProjectKey } from './project-sidebar';
import { QuickSearch, type QuickSearchHandle } from './quick-search';
import { type ShellActions, ShellContext } from './shell-context';

function InboxBell({ compact }: { compact: boolean }) {
  const { badge } = useInboxSummary();
  const label = badge > 0 ? `Inbox, ${badge} mục cần xử lý` : 'Inbox';
  return (
    <Link
      to="/inbox"
      aria-label={label}
      className={cn(
        'relative inline-flex min-h-11 items-center gap-2 rounded border text-sm text-ink no-underline hover:bg-soft xl:min-h-8',
        compact ? 'size-11 justify-center border-transparent' : 'border-line bg-panel px-3',
      )}
    >
      <Bell size={compact ? 20 : 16} aria-hidden />
      {!compact && 'Inbox'}
      {badge > 0 && (
        <span
          data-testid="inbox-badge"
          className={cn(
            'rounded-[10px] bg-bad px-[7px] text-xs font-bold text-white',
            compact && 'absolute top-1.5 right-1 px-[5px] text-[10px]',
          )}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}

function OwnerMenu({ onShortcuts }: { onShortcuts: () => void }) {
  const { session } = useRouteContext({ from: '/app' });
  const [theme, setTheme] = useTheme();
  const queryClient = useQueryClient();
  const router = useRouter();
  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setCsrfToken(null);
      queryClient.clear();
      queryClient.setQueryData(keys.session, null);
      router.history.push('/login');
    }
  };
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label="Menu tài khoản"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full xl:size-9"
        >
          <span className="inline-flex size-8 items-center justify-center rounded-full bg-[#243b64] text-xs font-bold text-white">
            Bạn
          </span>
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>{session.owner.username}</MenuLabel>
        {session.recoveryCodesLeft <= 3 && (
          <MenuLabel>
            <span className="text-bad">Còn {session.recoveryCodesLeft} mã khôi phục</span>
          </MenuLabel>
        )}
        <MenuItem onSelect={() => void router.navigate({ to: '/account' })}>
          <UserCog size={16} aria-hidden /> Tài khoản
        </MenuItem>
        <MenuItem onSelect={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
          {theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối'}
        </MenuItem>
        <MenuItem onSelect={onShortcuts} className="hidden xl:flex">
          <Keyboard size={16} aria-hidden /> Phím tắt
        </MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => void logout()}>
          <LogOut size={16} aria-hidden /> Đăng xuất
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}

function ShortcutSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Phím tắt" description="Dùng được trên màn hình máy tính.">
        <dl className="m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          {SHORTCUT_HELP.map((entry) => (
            <div key={entry.keys} className="contents">
              <dt>
                <kbd className="rounded border border-line bg-soft px-1.5 py-0.5 font-mono text-xs">
                  {entry.keys}
                </kbd>
              </dt>
              <dd className="m-0">{entry.label}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </DialogRoot>
  );
}

/**
 * The Jira-like frame around every signed-in page: top bar (logo, quick search, Tạo, Inbox, owner menu),
 * the project sidebar (full on desktop, icon rail on tablet, drawer on phone), global shortcuts and the
 * live event stream.
 */
export function AppShell() {
  const viewport = useViewport();
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();
  const projectKey = useCurrentProjectKey();
  const urlProjectKey = (useParams({ strict: false }) as { projectKey?: string }).projectKey;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [createOpen, setCreateOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [searchOverlay, setSearchOverlay] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const searchRef = useRef<QuickSearchHandle>(null);

  // Close the drawer whenever the page changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on navigation only
  useEffect(() => setDrawerOpen(false), [pathname]);

  useEffect(
    () =>
      startLiveEvents(queryClient, {
        onClosed: () => {
          void queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 }).then((session) => {
            if (!session)
              router.history.push(`/login?redirect=${encodeURIComponent(router.state.location.href)}`);
          });
        },
      }),
    [queryClient, router],
  );

  const actions: ShellActions = useMemo(
    () => ({
      openCreate: () => setCreateOpen(true),
      openSearch: () => (viewport === 'phone' ? setSearchOverlay(true) : searchRef.current?.focus()),
      openShortcuts: () => setShortcutsOpen(true),
    }),
    [viewport],
  );

  useShortcuts({
    '/': () => searchRef.current?.focus(),
    c: () => setCreateOpen(true),
    '?': () => setShortcutsOpen(true),
    'g i': () => void navigate({ to: '/inbox' }),
    'g a': () => void navigate({ to: '/board' }),
    'g b': () =>
      void (projectKey
        ? navigate({ to: '/projects/$projectKey/board', params: { projectKey } })
        : navigate({ to: '/requests' })),
    'g l': () => projectKey && void navigate({ to: '/projects/$projectKey/list', params: { projectKey } }),
    // The open project's docs; elsewhere the docs home, which lists every project.
    'g d': () => void (urlProjectKey ? navigate(docsHome(urlProjectKey)) : navigate(DOCS_INDEX)),
  });

  const phone = viewport === 'phone';

  return (
    <ShellContext.Provider value={actions}>
      <div className="flex h-dvh flex-col overflow-hidden bg-bg">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-panel px-2 md:gap-3.5 md:px-4 xl:h-[52px]">
          {phone && (
            <Button size="icon" variant="ghost" aria-label="Mở menu" onClick={() => setDrawerOpen(true)}>
              <Menu size={22} aria-hidden />
            </Button>
          )}
          <Link to="/" className="flex shrink-0 items-center gap-2 text-base font-bold text-ink no-underline">
            <span className="inline-flex size-[26px] items-center justify-center rounded-md bg-accent text-xs text-white">
              2P
            </span>
            <span className={cn(phone && 'sr-only')}>2P Crew</span>
          </Link>
          {!phone && <QuickSearch ref={searchRef} variant="inline" />}
          {!phone && (
            <Button variant="primary" onClick={() => setCreateOpen(true)} className="shrink-0">
              <Plus size={16} aria-hidden /> Tạo
              <kbd className="ml-1 hidden rounded-[3px] border border-current px-1 font-mono text-[11px] opacity-80 xl:inline">
                c
              </kbd>
            </Button>
          )}
          <span className="grow" />
          {phone && (
            <Button size="icon" variant="ghost" aria-label="Tìm kiếm" onClick={() => setSearchOverlay(true)}>
              <Search size={22} aria-hidden />
            </Button>
          )}
          <InboxBell compact={phone} />
          {phone && (
            <Button size="icon" variant="ghost" aria-label="Tạo ticket" onClick={() => setCreateOpen(true)}>
              <Plus size={24} aria-hidden />
            </Button>
          )}
          <OwnerMenu onShortcuts={() => setShortcutsOpen(true)} />
        </header>

        <div className="relative flex min-h-0 grow">
          {viewport === 'desktop' && <ProjectSidebar mode="full" />}
          {viewport === 'tablet' && <ProjectSidebar mode="rail" onExpand={() => setDrawerOpen(true)} />}
          {drawerOpen && viewport !== 'desktop' && (
            <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label="Menu">
              <div className="h-full shadow-xl">
                <ProjectSidebar mode="full" onNavigate={() => setDrawerOpen(false)} />
              </div>
              <button
                type="button"
                aria-label="Đóng menu"
                className="grow bg-[rgba(9,14,25,0.45)]"
                onClick={() => setDrawerOpen(false)}
              />
            </div>
          )}
          <main className="flex min-w-0 grow flex-col overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>

      {searchOverlay && (
        <div className="fixed inset-0 z-50 bg-panel" role="dialog" aria-modal="true" aria-label="Tìm kiếm">
          <QuickSearch variant="overlay" onDone={() => setSearchOverlay(false)} />
        </div>
      )}
      <NewTicketDialog open={createOpen} onOpenChange={setCreateOpen} defaultProjectKey={projectKey} />
      <ShortcutSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </ShellContext.Provider>
  );
}
