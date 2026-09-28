import type { SearchResponse } from '@crew/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, FileText, Search } from 'lucide-react';
import {
  forwardRef,
  type KeyboardEvent,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { StatusLozenge } from '../components/status-lozenge';
import { TypeIcon } from '../components/type-icon';
import { api } from '../lib/api-client';
import { cn } from '../lib/cn';
import { docsPage } from '../lib/docs-links';
import { keys, useProjects } from '../lib/queries';

type Result =
  | { kind: 'ticket'; item: SearchResponse['tickets'][number] }
  | { kind: 'doc'; item: SearchResponse['docs'][number]; projectKey: string | undefined };

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export interface QuickSearchHandle {
  focus: () => void;
}

/**
 * Quick search over tickets (key or title) and docs pages. Arrow keys move, Enter opens the selection,
 * Escape clears. `variant="overlay"` is the phone's full-screen search.
 */
export const QuickSearch = forwardRef<
  QuickSearchHandle,
  { variant: 'inline' | 'overlay'; onDone?: () => void }
>(function QuickSearch({ variant, onDone }, ref) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const projects = useProjects();
  const listId = useId();
  const q = useDebounced(text.trim(), 200);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  const search = useQuery({
    queryKey: keys.search(q),
    queryFn: ({ signal }) => api.search(q, signal),
    enabled: q.length > 0,
    staleTime: 5_000,
  });

  const results: Result[] = [
    ...(search.data?.tickets ?? []).map((item) => ({ kind: 'ticket' as const, item })),
    ...(search.data?.docs ?? []).map((item) => ({
      kind: 'doc' as const,
      item,
      projectKey: projects.data?.find((p) => p.id === item.projectId)?.key,
    })),
  ];
  const showList = (open || variant === 'overlay') && q.length > 0;

  const choose = (result: Result | undefined) => {
    if (!result) return;
    if (result.kind === 'ticket') {
      void navigate({ to: '/tickets/$ticketKey', params: { ticketKey: result.item.key } });
    } else if (result.projectKey) {
      void navigate(docsPage(result.projectKey, result.item.path));
    }
    setText('');
    setOpen(false);
    inputRef.current?.blur();
    onDone?.();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[active] ?? results[0]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (text) setText('');
      else {
        inputRef.current?.blur();
        onDone?.();
      }
    }
  };

  return (
    <div className={cn('relative', variant === 'inline' ? 'w-full max-w-[420px]' : 'flex h-full flex-col')}>
      <div
        className={cn(
          'flex items-center gap-2 rounded border border-line bg-bg px-2.5 text-muted focus-within:border-accent',
          variant === 'inline' ? 'h-[34px]' : 'm-3 h-11',
        )}
      >
        {variant === 'overlay' ? (
          <button
            type="button"
            aria-label="Đóng tìm kiếm"
            onClick={onDone}
            className="-ml-1 inline-flex size-9 items-center justify-center"
          >
            <ArrowLeft size={18} aria-hidden />
          </button>
        ) : (
          <Search size={16} aria-hidden />
        )}
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Tìm kiếm"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder="Tìm ticket theo key, tiêu đề, trang docs…"
          value={text}
          // biome-ignore lint/a11y/noAutofocus: the phone search overlay opens because the owner asked to search
          autoFocus={variant === 'overlay'}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          className="min-w-0 grow border-none bg-transparent text-sm text-ink outline-none"
        />
        {variant === 'inline' && (
          <kbd className="rounded-[3px] border border-current px-1 font-mono text-[11px] opacity-80">/</kbd>
        )}
      </div>
      {showList && (
        <div
          id={listId}
          role="listbox"
          aria-label="Kết quả tìm kiếm"
          className={cn(
            'overflow-y-auto bg-panel',
            variant === 'inline'
              ? 'absolute top-10 right-0 left-0 z-40 max-h-[60vh] rounded-md border border-line shadow-lg'
              : 'grow border-t border-line2',
          )}
        >
          {search.isFetching && results.length === 0 && (
            <p className="m-0 p-3 text-sm text-muted">Đang tìm…</p>
          )}
          {!search.isFetching && results.length === 0 && (
            <p className="m-0 p-3 text-sm text-muted">Không có kết quả cho “{q}”.</p>
          )}
          {results.map((result, index) => (
            <div
              key={result.kind === 'ticket' ? result.item.id : `${result.item.projectId}:${result.item.path}`}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(result)}
              onKeyDown={() => {}}
              onMouseEnter={() => setActive(index)}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm',
                index === active && 'bg-soft',
              )}
            >
              {result.kind === 'ticket' ? (
                <>
                  <TypeIcon type={result.item.type} />
                  <span className="font-mono text-xs text-muted">{result.item.key}</span>
                  <span className="min-w-0 grow truncate">{result.item.title}</span>
                  <StatusLozenge status={result.item.status} />
                </>
              ) : (
                <>
                  <FileText size={16} aria-hidden className="text-muted" />
                  <span className="min-w-0 grow truncate">{result.item.title}</span>
                  <span className="font-mono text-xs text-muted">{result.projectKey}</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
