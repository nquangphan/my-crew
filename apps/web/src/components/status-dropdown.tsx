import { allowedTransitions, type TicketStatus } from '@crew/shared';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';
import { STATUS_LABEL, STATUS_TONE } from '../lib/format';
import { TONE_CLASS } from './status-lozenge';
import { MenuContent, MenuItem, MenuLabel, MenuRoot, MenuTrigger } from './ui/dropdown-menu';

/** Owner targets for a status, exactly the ones `canTransition('owner', from, to)` allows. */
export function ownerTargets(status: TicketStatus): TicketStatus[] {
  return allowedTransitions('owner', status);
}

/**
 * Jira status button: the current status as a coloured lozenge; the menu lists only legal owner moves.
 */
export function StatusDropdown({
  status,
  onSelect,
  disabled,
  className,
}: {
  status: TicketStatus;
  onSelect: (to: TicketStatus) => void;
  disabled?: boolean;
  className?: string;
}) {
  const targets = ownerTargets(status);
  return (
    <MenuRoot>
      <MenuTrigger asChild disabled={disabled || targets.length === 0}>
        <button
          type="button"
          aria-label={`Trạng thái: ${STATUS_LABEL[status]}. Đổi trạng thái`}
          className={cn(
            'inline-flex min-h-11 items-center gap-1 rounded border border-transparent px-3 text-[13px] font-bold tracking-[0.02em] uppercase disabled:cursor-default xl:min-h-8',
            TONE_CLASS[STATUS_TONE[status]],
            className,
          )}
        >
          {STATUS_LABEL[status]}
          {targets.length > 0 && <ChevronDown size={14} aria-hidden />}
        </button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>Chuyển sang</MenuLabel>
        {targets.map((to) => (
          <MenuItem key={to} onSelect={() => onSelect(to)}>
            <span
              className={cn(
                'rounded-[3px] px-1.5 py-0.5 text-[11px] font-bold uppercase',
                TONE_CLASS[STATUS_TONE[to]],
              )}
            >
              {STATUS_LABEL[to]}
            </span>
          </MenuItem>
        ))}
      </MenuContent>
    </MenuRoot>
  );
}
