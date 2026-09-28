import { type MouseEvent, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';

export interface TocHeading {
  id: string;
  text: string;
  level: 2 | 3;
}

/** How far below the top of the scroll box a heading counts as the current section. */
const ACTIVE_OFFSET = 96;

/** Scrolls a heading of the page into view (the docs area, not the window, is the scroll box). */
export function scrollToHeading(id: string): void {
  document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/** Tracks the section at the top of the docs scroll box. */
function useActiveHeading(headings: readonly TocHeading[]): [string | null, (id: string) => void] {
  const [active, setActive] = useState<string | null>(headings[0]?.id ?? null);
  useEffect(() => {
    const first = headings[0] && document.getElementById(headings[0].id);
    const root = first?.closest<HTMLElement>('[data-docs-scroll]');
    if (!root) return;
    const update = () => {
      const top = root.getBoundingClientRect().top + ACTIVE_OFFSET;
      let current = headings[0]?.id ?? null;
      for (const heading of headings) {
        const element = document.getElementById(heading.id);
        if (element && element.getBoundingClientRect().top <= top) current = heading.id;
      }
      setActive(current);
    };
    update();
    root.addEventListener('scroll', update, { passive: true });
    return () => root.removeEventListener('scroll', update);
  }, [headings]);
  return [active, setActive];
}

function TocLinks({
  headings,
  active,
  onPick,
  compact,
}: {
  headings: readonly TocHeading[];
  active: string | null;
  onPick: (id: string) => void;
  compact: boolean;
}) {
  const pick = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    event.preventDefault();
    onPick(id);
    scrollToHeading(id);
  };
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {headings.map((heading) => (
        <li key={heading.id} className={cn(heading.level === 3 && 'pl-3')}>
          <a
            href={`#${encodeURIComponent(heading.id)}`}
            onClick={(event) => pick(event, heading.id)}
            aria-current={heading.id === active ? 'location' : undefined}
            className={cn(
              'block text-muted no-underline hover:text-accent hover:underline',
              compact && 'flex min-h-11 items-center',
              heading.id === active && !compact && 'font-semibold text-accent',
            )}
          >
            {heading.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Trên trang này": the page's h2/h3 headings. `sidebar` is the sticky column on desktop (the current section
 * is highlighted); `collapsed` is the `<details>` block at the top of the article on phone and tablet.
 */
export function DocsToc({
  headings,
  variant,
}: {
  headings: readonly TocHeading[];
  variant: 'sidebar' | 'collapsed';
}) {
  const [active, setActive] = useActiveHeading(headings);
  const details = useRef<HTMLDetailsElement>(null);
  if (headings.length === 0) return null;

  if (variant === 'collapsed') {
    return (
      <details ref={details} className="rounded-md border border-line bg-panel text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 font-semibold">
          Trên trang này
        </summary>
        <nav aria-label="Mục lục" className="px-3 pb-2">
          <TocLinks
            headings={headings}
            active={active}
            compact
            onPick={(id) => {
              setActive(id);
              if (details.current) details.current.open = false;
            }}
          />
        </nav>
      </details>
    );
  }

  return (
    <nav aria-label="Mục lục" className="flex flex-col gap-1.5 text-[13px]">
      <strong className="text-xs tracking-[0.06em] text-muted uppercase">Trên trang này</strong>
      <TocLinks headings={headings} active={active} onPick={setActive} compact={false} />
    </nav>
  );
}
