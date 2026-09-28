import { Link, type LinkProps } from '@tanstack/react-router';
import { Fragment } from 'react';

export interface Crumb {
  label: string;
  link?: LinkProps;
  mono?: boolean;
}

/** `Dự án / PRJ / PRJ-12`: shown at the top of every page. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 truncate text-[13px] text-muted">
      {items.map((item, index) => (
        <Fragment key={item.label}>
          {index > 0 && <span className="px-1">/</span>}
          {item.link ? (
            <Link {...item.link} className={item.mono ? 'font-mono text-muted' : 'text-muted'}>
              {item.label}
            </Link>
          ) : (
            <span
              className={item.mono ? 'font-mono' : undefined}
              aria-current={index === items.length - 1 ? 'page' : undefined}
            >
              {item.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
