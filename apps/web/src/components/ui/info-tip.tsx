import { Popover as P } from 'radix-ui';
import type { ReactNode } from 'react';

/**
 * A tooltip that also works by tap: the trigger toggles a popover, so no information is hover-only.
 */
export function InfoTip({
  label,
  children,
  trigger,
}: {
  label: string;
  children: ReactNode;
  trigger: ReactNode;
}) {
  return (
    <P.Root>
      <P.Trigger asChild>
        <button type="button" aria-label={label} className="inline-flex min-h-6 items-center">
          {trigger}
        </button>
      </P.Trigger>
      <P.Portal>
        <P.Content
          sideOffset={4}
          className="z-50 max-w-72 rounded-md border border-line bg-panel px-3 py-2 text-[13px] shadow-lg"
        >
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
