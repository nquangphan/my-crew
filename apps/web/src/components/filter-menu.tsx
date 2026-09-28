import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from './ui/dropdown-menu';

/** Multi-select filter button (Jira "Loại: Tất cả ▾"); the menu stays a plain list of toggles. */
export function FilterMenu<T extends string>({
  label,
  options,
  selected,
  render,
  onToggle,
}: {
  label: string;
  options: readonly T[];
  selected: readonly T[];
  render: (value: T) => ReactNode;
  onToggle: (value: T) => void;
}) {
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex min-h-11 items-center gap-1 rounded border px-3 text-sm xl:min-h-8',
            selected.length > 0
              ? 'border-accent bg-accent-bg text-accent-ink'
              : 'border-line bg-panel hover:bg-soft',
          )}
        >
          {label}: {selected.length > 0 ? selected.length : 'Tất cả'} <ChevronDown size={14} aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent>
        {options.map((option) => (
          <MenuItem key={option} onSelect={() => onToggle(option)}>
            <span className="inline-flex w-4 justify-center">
              {selected.includes(option) && <Check size={14} aria-hidden />}
            </span>
            {render(option)}
          </MenuItem>
        ))}
      </MenuContent>
    </MenuRoot>
  );
}
