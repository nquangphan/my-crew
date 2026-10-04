/**
 * The one ticket dialog shared by board, list, request selection, graph, docs and Assistant links. It renders
 * `TicketDetail` in dialog presentation inside a Radix modal (Title/Description, focus trap, inert
 * background, Escape and the X button). On close focus returns to the trigger, or — if the trigger left the
 * DOM — to the nearest `[data-focus-fallback]` container captured at open time, then to `#main-content`.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { type CSSProperties, useEffect, useRef } from 'react';
import { TicketDetail } from './detail.tsx';
import { pickReturnFocus } from './status.ts';

export type TicketDialogProps = {
  ticketId: string | null;
  onClose: () => void;
  returnFocus: HTMLElement | null;
};

const overlayStyle: CSSProperties = { position: 'fixed', inset: 0, background: 'rgb(15 23 42 / 0.45)' };
const contentStyle: CSSProperties = {
  position: 'fixed',
  top: '4vh',
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'min(60rem, calc(100vw - 2rem))',
  maxHeight: '92vh',
  overflow: 'auto',
  boxSizing: 'border-box',
  padding: '1.5rem',
  borderRadius: '0.75rem',
  background: 'Canvas',
  color: 'CanvasText',
  boxShadow: '0 1.5rem 3rem rgb(15 23 42 / 0.3)',
};
const closeStyle: CSSProperties = {
  float: 'right',
  font: 'inherit',
  fontSize: '1.25rem',
  lineHeight: 1,
  padding: '0.35rem 0.6rem',
  borderRadius: '0.5rem',
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};

export function TicketDialog({ ticketId, onClose, returnFocus }: TicketDialogProps) {
  const fallback = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (ticketId !== null)
      fallback.current = returnFocus?.parentElement?.closest<HTMLElement>('[data-focus-fallback]') ?? null;
  }, [ticketId, returnFocus]);

  return (
    <Dialog.Root
      open={ticketId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay style={overlayStyle} />
        <Dialog.Content
          style={contentStyle}
          data-testid="ticket-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            pickReturnFocus([returnFocus, fallback.current, document.getElementById('main-content')])?.focus({
              preventScroll: true,
            });
          }}
        >
          <Dialog.Close style={closeStyle} aria-label="Đóng">
            <span aria-hidden="true">×</span>
          </Dialog.Close>
          {ticketId !== null && <TicketDetail key={ticketId} ticketId={ticketId} presentation="dialog" />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
