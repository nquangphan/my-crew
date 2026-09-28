import { DropdownMenu as M } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export const MenuRoot = M.Root;
export const MenuTrigger = M.Trigger;

export function MenuContent({ children, align = 'start' }: { children: ReactNode; align?: 'start' | 'end' }) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={4}
        className="z-50 min-w-44 rounded-md border border-line bg-panel p-1 shadow-lg"
      >
        {children}
      </M.Content>
    </M.Portal>
  );
}

export function MenuItem({
  children,
  onSelect,
  className,
  disabled,
}: {
  children: ReactNode;
  onSelect: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <M.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex min-h-11 cursor-pointer items-center gap-2 rounded px-2.5 text-sm outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-soft xl:min-h-8',
        className,
      )}
    >
      {children}
    </M.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="px-2.5 py-1 text-xs font-semibold text-muted">{children}</M.Label>;
}

export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-line2" />;
