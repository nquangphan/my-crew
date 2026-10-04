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

// Dark theme of the owner-approved map mockup (dialog surface #17191c, border #2b2f35).
const overlayStyle: CSSProperties = { position: 'fixed', inset: 0, background: 'rgb(0 0 0 / 0.6)' };
const contentStyle: CSSProperties = {
  position: 'fixed',
  top: '4vh',
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'min(60rem, calc(100vw - 2rem))',
  maxHeight: '92vh',
  overflow: 'auto',
  boxSizing: 'border-box',
  padding: '18px 20px',
  borderRadius: 6,
  border: '1px solid #2b2f35',
  background: '#17191c',
  color: '#e8e9eb',
  colorScheme: 'dark',
  boxShadow: '0 1.5rem 3rem rgb(0 0 0 / 0.45)',
};
const closeStyle: CSSProperties = {
  float: 'right',
  width: 36,
  height: 36,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginLeft: 16,
  padding: 0,
  borderRadius: 4,
  border: '1px solid #2b2f35',
  background: 'transparent',
  color: '#9aa0a6',
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
          className="ticket-dialog"
          data-testid="ticket-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            pickReturnFocus([returnFocus, fallback.current, document.getElementById('main-content')])?.focus({
              preventScroll: true,
            });
          }}
        >
          <Dialog.Close style={closeStyle} aria-label="Đóng">
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M2 2l10 10M12 2L2 12" />
            </svg>
          </Dialog.Close>
          {ticketId !== null && <TicketDetail key={ticketId} ticketId={ticketId} presentation="dialog" />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
