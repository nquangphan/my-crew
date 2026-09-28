import { Link } from '@tanstack/react-router';
import { ArrowLeft, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cn } from '../lib/cn';
import { useTicket } from '../lib/queries';
import { useViewport } from '../lib/ui-state';
import { TicketView } from './ticket-view';
import { Button } from './ui/button';

/**
 * The ticket over the board, keeping the board in place: a 580 px right panel on desktop, an 80 % overlay
 * on tablet and a full-screen view on phones. Esc closes it.
 */
export function TicketSidePanel({
  ticketKey,
  onClose,
  onOpenTicket,
}: {
  ticketKey: string;
  onClose: () => void;
  onOpenTicket: (key: string) => void;
}) {
  const viewport = useViewport();
  const detail = useTicket(ticketKey);
  const panelRef = useRef<HTMLElement>(null);
  const projectKey = detail.data?.ticket.key.split('-')[0];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (viewport !== 'desktop') panelRef.current?.focus();
  }, [viewport]);

  return (
    <>
      {viewport === 'tablet' && (
        <button
          type="button"
          aria-label="Đóng panel"
          className="fixed inset-0 z-30 bg-[rgba(9,14,25,0.35)]"
          onClick={onClose}
        />
      )}
      <aside
        ref={panelRef}
        tabIndex={-1}
        aria-label={`Panel ticket ${ticketKey}`}
        className={cn(
          'fixed z-40 flex flex-col bg-panel outline-none',
          viewport === 'desktop' &&
            'top-[52px] right-0 bottom-0 w-[580px] border-l border-line shadow-[-12px_0_24px_rgba(23,32,51,0.08)]',
          viewport === 'tablet' && 'inset-y-0 right-0 w-[80%] border-l border-line shadow-xl',
          viewport === 'phone' && 'inset-0',
        )}
      >
        <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-line2 px-2 text-[13px] text-muted md:px-5 xl:min-h-12">
          {viewport === 'phone' && (
            <Button size="icon" variant="ghost" aria-label="Quay lại" onClick={onClose}>
              <ArrowLeft size={22} aria-hidden />
            </Button>
          )}
          <span className="font-mono">
            {projectKey ? `${projectKey} / ` : ''}
            {ticketKey}
          </span>
          <span className="grow" />
          <Link
            to="/tickets/$ticketKey"
            params={{ ticketKey }}
            className="inline-flex min-h-11 items-center px-1"
          >
            Mở toàn trang
          </Link>
          {viewport !== 'phone' && (
            <Button
              size="icon"
              variant="ghost"
              aria-label="Đóng panel"
              onClick={onClose}
              className="xl:size-8"
            >
              <X size={18} aria-hidden />
            </Button>
          )}
        </div>
        <div className="flex grow flex-col overflow-y-auto px-3 pt-4 md:px-5">
          <TicketView ticketKey={ticketKey} mode="panel" onOpenTicket={onOpenTicket} />
          <div className="h-4 shrink-0" />
        </div>
      </aside>
    </>
  );
}
