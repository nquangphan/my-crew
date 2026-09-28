import { Dialog as D } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export const DialogRoot = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

/**
 * Centered modal on tablet and desktop, full screen on phones. Radix traps focus, closes on Esc and sets
 * `aria-modal`, which also pauses the page shortcuts.
 */
export function DialogContent({
  title,
  description,
  children,
  className,
  wide,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-[rgba(9,14,25,0.45)]" />
      <D.Content
        className={cn(
          'fixed inset-0 z-50 flex flex-col overflow-y-auto bg-panel p-4 shadow-xl outline-none',
          'md:inset-auto md:top-[8vh] md:left-1/2 md:max-h-[84vh] md:w-[92vw] md:-translate-x-1/2 md:rounded-lg md:border md:border-line md:p-6',
          wide ? 'md:max-w-3xl' : 'md:max-w-xl',
          className,
        )}
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 grow">
            <D.Title className="m-0 text-lg font-semibold">{title}</D.Title>
            {description ? (
              <D.Description className="mt-1 text-[13px] text-muted">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{title}</D.Description>
            )}
          </div>
          <D.Close
            aria-label="Đóng"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded text-muted hover:bg-soft xl:size-8"
          >
            ✕
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}
