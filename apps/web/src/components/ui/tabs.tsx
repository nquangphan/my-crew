import { Tabs as T } from 'radix-ui';
import type { ReactNode } from 'react';

export const TabsRoot = T.Root;
export const TabsContent = T.Content;

export function TabsList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <T.List aria-label={label} className="flex gap-5 border-b border-line2 text-sm">
      {children}
    </T.List>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <T.Trigger
      value={value}
      className="-mb-px min-h-11 border-b-2 border-transparent px-0 text-muted data-[state=active]:border-accent data-[state=active]:font-semibold data-[state=active]:text-accent xl:min-h-9"
    >
      {children}
    </T.Trigger>
  );
}
