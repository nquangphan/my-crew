import { appendEvent } from '../journal/events.ts';
import type { Actor, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type { DocsSourceReader, Ticket } from './contracts.ts';
import { mapTicket, requireTicket } from './service.ts';

export async function linkDocs(
  tx: Tx,
  ticketId: Id,
  snapshotId: Id,
  paths: string[],
  expectedRevision: number,
  actor: Actor,
  docsSource?: DocsSourceReader,
): Promise<Ticket> {
  if (
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 1 ||
    !Array.isArray(paths) ||
    paths.length < 1 ||
    paths.length > 100 ||
    new Set(paths).size !== paths.length ||
    paths.some((path) => typeof path !== 'string' || !path || path.length > 4096)
  )
    throw new ApiError('VALIDATION', 400, 'Liên kết docs không hợp lệ');
  const ticket = await requireTicket(tx, ticketId, actor, true);
  if (ticket.revision !== expectedRevision)
    throw new ApiError('REVISION_CONFLICT', 409, 'Ticket đã thay đổi');
  if (!docsSource) throw new ApiError('DOCS_SOURCE_UNVERIFIED', 422, 'Snapshot docs chưa được xác minh');
  for (const path of paths) {
    if (!(await docsSource(tx, ticket.projectId, snapshotId, path)))
      throw new ApiError('DOCS_SOURCE_UNVERIFIED', 422, 'Trang docs chưa được xác minh');
  }
  await tx`delete from ticket_docs where ticket_id=${ticketId}`;
  for (const path of paths)
    await tx`insert into ticket_docs(ticket_id,snapshot_id,path)
    values(${ticketId},${snapshotId},${path})`;
  const [updated] = await tx`update tickets set revision=revision+1 where id=${ticketId} returning *`;
  await appendEvent(tx, {
    type: 'ticket.changed',
    projectId: ticket.projectId,
    ticketId,
    audienceMachineId: null,
    data: { revision: Number(updated?.revision), status: ticket.status },
  });
  return mapTicket(updated as Record<string, unknown>);
}
