import { randomUUID } from 'node:crypto';
import type { Actor, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import { requireProjectScope } from '../tickets/service.ts';
import { liveLinkIds, notFound } from './access.ts';
import { validId } from './submissions.ts';
export async function lockInputTarget(
  tx: Tx,
  target: { kind: 'ticket'; ticketId: Id; projectId: Id } | { kind: 'message'; messageId: Id },
): Promise<{ revision: string; routeRevision: number }> {
  const id = target.kind === 'ticket' ? target.ticketId : target.messageId;
  if (target.kind === 'ticket') {
    const [row] = await tx`select root_id,project_id from tickets where id=${id}`;
    if (!row || row.project_id !== target.projectId) notFound();
    await tx`select id from tickets where id=${row.root_id} for update`;
    await tx`select id from tickets where id=${id} for update`;
    await tx`select id from projects where id=${target.projectId} for update`;
  } else {
    // Routes lock a real root first, matching the accepted routing writer.
    const [route] =
      await tx`select t.root_id,t.id,t.project_id from attachment_message_routes r join tickets t on t.id=r.ticket_id where r.message_id=${id} and r.revoked_at is null`;
    if (route) {
      await tx`select id from tickets where id=${route.root_id} for update`;
      await tx`select id from tickets where id=${route.id} for update`;
      await tx`select id from projects where id=${route.project_id} for update`;
    }
    const [message] = await tx`select id from attachment_messages where id=${id} for update`;
    if (!message) notFound();
  }
  await tx`insert into attachment_input_revisions(target_kind,target_id) values(${target.kind},${id}) on conflict do nothing`;
  const [row] =
    await tx`select revision,route_revision from attachment_input_revisions where target_kind=${target.kind} and target_id=${id} for update`;
  return { revision: String(row.revision), routeRevision: Number(row.route_revision) };
}
export async function inheritAttachmentLinks(
  tx: Tx,
  ticketId: Id,
  sourceLinkIds: Id[],
  actor: Actor,
): Promise<Id[]> {
  if (
    !validId(ticketId) ||
    !Array.isArray(sourceLinkIds) ||
    !sourceLinkIds.length ||
    sourceLinkIds.length > 100 ||
    !sourceLinkIds.every(validId) ||
    new Set(sourceLinkIds).size !== sourceLinkIds.length
  )
    throw new ApiError('VALIDATION', 400, 'Tham chiếu không hợp lệ');
  const [ticket] = await tx`select project_id,root_id from tickets where id=${ticketId}`;
  if (!ticket) notFound();
  await lockInputTarget(tx, { kind: 'ticket', ticketId, projectId: String(ticket.project_id) });
  await requireProjectScope(tx, String(ticket.project_id), actor);
  const ancestors =
    await tx`with recursive ancestors as(select id,parent_id,root_id,project_id from tickets where id=${ticketId} union all select t.id,t.parent_id,t.root_id,t.project_id from tickets t join ancestors a on a.parent_id=t.id) select * from ancestors where id<>${ticketId}`;
  const allowed = ancestors
    .filter((a) => a.root_id === ticket.root_id && a.project_id === ticket.project_id)
    .map((a) => String(a.id));
  if (!allowed.length) notFound();
  const sources =
    await tx`select * from attachment_links where id in ${tx(sourceLinkIds)} order by id for share`;
  if (sources.length !== sourceLinkIds.length) notFound();
  for (const s of sources)
    if (
      s.project_id !== ticket.project_id ||
      !allowed.includes(String(s.ticket_id)) ||
      !(await liveLinkIds(tx, String(s.ticket_id))).includes(String(s.id))
    )
      notFound();
  const ids: Id[] = [];
  let changed = false;
  for (const s of sources) {
    const [existing] =
      await tx`select id,revoked_at,inherited_from_link_id from attachment_links where attachment_id=${s.attachment_id} and ticket_id=${ticketId} and comment_id is null`;
    if (existing) {
      if (existing.revoked_at || existing.inherited_from_link_id !== s.id)
        throw new ApiError('REFERENCE_CONFLICT', 409, 'Tham chiếu đã thay đổi');
      ids.push(String(existing.id));
      continue;
    }
    const id = randomUUID();
    await tx`insert into attachment_links(id,attachment_id,project_id,ticket_id,inherited_from_link_id) values(${id},${s.attachment_id},${ticket.project_id},${ticketId},${s.id})`;
    ids.push(id);
    changed = true;
  }
  if (changed)
    await tx`update attachment_input_revisions set revision=revision+1 where target_kind='ticket' and target_id=${ticketId}`;
  return ids;
}
export async function submittedOriginals(
  tx: Tx,
  target: import('./contracts.ts').InputTarget,
): Promise<import('./contracts.ts').AttachmentRef[]> {
  let rows: Record<string, unknown>[];
  if (target.kind === 'message')
    rows =
      await tx`select u.id,u.expected_sha256 from attachment_message_links l join attachment_uploads u on u.id=l.attachment_id where l.message_id=${target.messageId} and l.sha256=u.expected_sha256 and u.linked_at is not null order by u.id`;
  else {
    const ids = await liveLinkIds(tx, target.ticketId);
    if (!ids.length) return [];
    rows =
      await tx`select distinct u.id,u.expected_sha256 from attachment_links l join attachment_uploads u on u.id=l.attachment_id where l.id in ${tx(ids)} and l.project_id=${target.projectId} and u.linked_at is not null order by u.id`;
  }
  return rows.map((r) => ({
    attachmentId: String(r.id),
    sha256: String(r.expected_sha256),
    ownerId: 'owner',
  }));
}

// Production input composition must capture this transaction wrapper in the
// reviewed jobs factory. Standalone worker publication does not serialize claim.
export function createAttachmentPublication(
  db: import('../platform/contracts.ts').Db,
): import('./jobs.ts').ExtractionPublication {
  return async (input, work) => {
    const committed = await db.begin(async (tx) => {
      // Background publication takes the real journal lock without inventing an
      // owner request/consent. Current extraction generation/CAS supplies replay.
      await tx`select value from event_cursor where singleton for update`;
      const links =
        await tx`select distinct ticket_id from attachment_links where attachment_id=${input.original.attachmentId} and revoked_at is null order by ticket_id`;
      const liveSeeds: Id[] = [];
      for (const link of links) {
        const live = await liveLinkIds(tx, String(link.ticket_id));
        if (live.length) {
          const [match] =
            await tx`select id from attachment_links where id in ${tx(live)} and attachment_id=${input.original.attachmentId}`;
          if (match) liveSeeds.push(String(link.ticket_id));
        }
      }
      const messages =
        await tx`select m.id,r.ticket_id from attachment_messages m join attachment_message_links l on l.message_id=m.id left join attachment_message_routes r on r.message_id=m.id and r.revoked_at is null where l.attachment_id=${input.original.attachmentId} order by m.id`;
      const routed = messages.filter((m) => m.ticket_id !== null).map((m) => String(m.ticket_id));
      const seeds = [...new Set([...liveSeeds, ...routed])];
      // Metadata/comment ancestry makes descendants affected even before an
      // explicit child ref exists; this does not grant them byte access.
      const tickets = seeds.length
        ? await tx`with recursive affected as(select id,root_id,project_id from tickets where id in ${tx(seeds)} union select t.id,t.root_id,t.project_id from tickets t join affected a on t.parent_id=a.id) select * from affected order by id`
        : [];
      const roots = [...new Set(tickets.map((t) => String(t.root_id)))].sort();
      if (roots.length) await tx`select id from tickets where id in ${tx(roots)} order by id for update`;
      const ids = tickets.map((t) => String(t.id));
      if (ids.length) await tx`select id from tickets where id in ${tx(ids)} order by id for update`;
      const projects = [...new Set(tickets.map((t) => String(t.project_id)))].sort();
      if (projects.length)
        await tx`select id from projects where id in ${tx(projects)} order by id for update`;
      const messageIds = messages.map((m) => String(m.id));
      if (messageIds.length)
        await tx`select id from attachment_messages where id in ${tx(messageIds)} order by id for update`;
      // All public link/routing writers share event_cursor, so re-reading here also
      // verifies scope after acquiring root/target locks without admitting new refs.
      const recheck =
        await tx`select distinct ticket_id from attachment_links where attachment_id=${input.original.attachmentId} and revoked_at is null order by ticket_id`;
      if (recheck.length !== links.length || recheck.some((r, i) => r.ticket_id !== links[i]?.ticket_id))
        throw new ApiError('INPUT_SNAPSHOT_STALE', 409, 'Liên kết input đã đổi');
      const targets = [
        ...tickets.map((t) => ({
          kind: 'ticket' as const,
          id: String(t.id),
          projectId: String(t.project_id),
        })),
        ...messages.map((m) => ({ kind: 'message' as const, id: String(m.id), projectId: null })),
      ];
      targets.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
      for (const t of targets) {
        await tx`insert into attachment_input_revisions(target_kind,target_id) values(${t.kind},${t.id}) on conflict do nothing`;
        await tx`select target_id from attachment_input_revisions where target_kind=${t.kind} and target_id=${t.id} for update`;
      }
      const result = await work(tx);
      const { appendEvent } = await import('../journal/events.ts');
      for (const t of targets) {
        const [revision] =
          await tx`update attachment_input_revisions set revision=revision+1 where target_kind=${t.kind} and target_id=${t.id} returning revision`;
        if (t.kind === 'message')
          await tx`update attachment_messages set input_revision=${String(revision.revision)} where id=${t.id}`;
        const revoked =
          await tx`update attachment_assistant_grants set revoked_at=clock_timestamp() where target_kind=${t.kind} and target_id=${t.id} and revoked_at is null returning id,machine_id`;
        const audiences = [...new Set(revoked.map((g) => String(g.machine_id)))];
        if (revoked.length)
          await tx`update attachment_assistant_sessions set state='unknown' where grant_id in ${tx(revoked.map((g) => String(g.id)))} and state in ('reserved','running')`;
        for (const audienceMachineId of audiences)
          await appendEvent(tx, {
            type: 'attachment.input.changed',
            projectId: t.projectId,
            ticketId: t.kind === 'ticket' ? t.id : null,
            audienceMachineId,
            data: { targetKind: t.kind, targetId: t.id, inputRevision: String(revision.revision) },
          });
      }
      return { value: result };
    });
    return committed.value;
  };
}
