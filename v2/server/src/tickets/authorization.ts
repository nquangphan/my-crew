import type { Actor, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
/** Journal holds event_cursor first. Entity locks then follow execution's root/ticket/project order. */
export async function authorizeTicketMutation(
  tx: Tx,
  actor: Actor,
  target: { projectId?: Id; ticketId?: Id; parentId?: Id | null },
): Promise<void> {
  if (actor.kind === 'owner') return;
  let projectId = target.projectId;
  const ticketId = target.ticketId ?? target.parentId;
  if (ticketId) {
    const [scope] = await tx`select root_id,project_id from tickets where id=${ticketId}`;
    if (!scope) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket');
    await tx`select id from tickets where id=${scope.root_id} for update`;
    await tx`select id from tickets where id=${ticketId} for update`;
    if (projectId && scope.project_id !== projectId)
      throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket');
    projectId = scope.project_id as Id;
  }
  if (!projectId) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy dự án');
  const [project] = await tx`select machine_id from projects where id=${projectId} for update`;
  if (!project) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy dự án');
  if (actor.kind === 'machine') {
    const [machine] = await tx`select revoked_at from machines where id=${actor.id} for share`;
    if (!machine || machine.revoked_at || project.machine_id !== actor.id)
      throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy dự án');
  }
}
