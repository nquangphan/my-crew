import type { Ticket } from '@crew/shared';
import { errorMessage } from '../lib/format';
import { useOpenDescendants } from '../lib/queries';
import { StatusLozenge } from './status-lozenge';
import { TypeIcon } from './type-icon';
import { Button } from './ui/button';
import { DialogContent, DialogRoot } from './ui/dialog';

/**
 * Confirms cancelling a ticket from any open state and lists every open descendant the server will
 * cancel with it.
 */
export function CancelDialog({
  ticket,
  open,
  onOpenChange,
  onConfirm,
  busy,
  error,
}: {
  ticket: Ticket;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  busy?: boolean;
  error?: unknown;
}) {
  const descendants = useOpenDescendants(ticket, open);
  const list = descendants.data ?? [];
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Hủy ${ticket.key}?`}
        description="Agent đang chạy trên các ticket này sẽ dừng lại."
      >
        <div className="flex flex-col gap-3 text-sm">
          {descendants.isLoading ? (
            <p className="m-0 text-muted">Đang tải ticket con…</p>
          ) : list.length === 0 ? (
            <p className="m-0">Ticket này không có ticket con đang mở.</p>
          ) : (
            <>
              <p className="m-0">{list.length} ticket con đang mở cũng sẽ bị hủy:</p>
              <ul
                aria-label="Ticket con sẽ bị hủy"
                className="m-0 flex max-h-64 list-none flex-col gap-1 overflow-y-auto p-0"
              >
                {list.map((child) => (
                  <li
                    key={child.id}
                    className="flex items-center gap-2 rounded border border-line2 px-2.5 py-1.5"
                  >
                    <TypeIcon type={child.type} />
                    <span className="font-mono text-xs text-muted">{child.key}</span>
                    <span className="min-w-0 grow truncate">{child.title}</span>
                    <StatusLozenge status={child.status} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {descendants.isError && (
            <p role="alert" className="m-0 text-bad">
              Không tải được ticket con.
            </p>
          )}
          {error ? (
            <p role="alert" className="m-0 text-bad">
              {errorMessage(error)}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => onOpenChange(false)}>Không</Button>
            <Button variant="danger" onClick={onConfirm} disabled={busy || descendants.isLoading}>
              {busy ? 'Đang hủy…' : `Hủy ${ticket.key}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
