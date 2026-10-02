import { randomUUID } from 'node:crypto';
import { canonicalJson } from '../journal/canonical.ts';
import { appendEvent } from '../journal/events.ts';
import type { Actor, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type { AssistantMessage, MessageSubmission } from './contracts.ts';
import {
  authorizeSubmission,
  createSelectionServices,
  digest,
  finishSubmission,
  normalizeSelection,
  ownerOnly,
  permission,
  readSubmission,
  record,
  type SelectionDependencies,
  validId,
} from './submissions.ts';

export type MessageDecisionInput = {
  messageId: Id;
  inputRevision: string;
  snapshotId: Id | null;
  grantId: Id | null;
  receiptId: Id | null;
  kind: 'routing' | 'scope' | 'reply';
  body: Record<string, unknown>;
};
export type MessageDecisionAuthority = (tx: Tx, input: MessageDecisionInput, actor: Actor) => Promise<void>;
function decodeMessage(value: unknown): AssistantMessage {
  if (
    !record(value) ||
    !validId(value.id) ||
    !validId(value.conversationId) ||
    value.ownerId !== 'owner' ||
    typeof value.text !== 'string' ||
    !Array.isArray(value.attachmentIds) ||
    !value.attachmentIds.every(validId) ||
    typeof value.inputRevision !== 'string' ||
    !/^\d+$/.test(value.inputRevision) ||
    typeof value.routeRevision !== 'number' ||
    !Number.isSafeInteger(value.routeRevision) ||
    typeof value.createdAt !== 'string'
  )
    throw new Error('MESSAGE_RECEIPT_INVALID');
  return {
    id: value.id,
    conversationId: value.conversationId,
    ownerId: 'owner',
    text: value.text,
    attachmentIds: value.attachmentIds,
    inputRevision: value.inputRevision,
    routeRevision: value.routeRevision,
    createdAt: value.createdAt,
  };
}
export function createMessageServices(
  deps: SelectionDependencies & { decisionAuthority?: MessageDecisionAuthority },
) {
  const selected = createSelectionServices(deps),
    decisionAuthority = deps.decisionAuthority;
  return Object.freeze({
    async createConversation(tx: Tx, actor: Actor): Promise<{ id: Id; ownerId: 'owner'; createdAt: string }> {
      ownerOnly(actor);
      const [row] =
        await tx`insert into attachment_conversations(id) values(${randomUUID()}) returning id,created_at`;
      return {
        id: String(row.id),
        ownerId: 'owner',
        createdAt: new Date(String(row.created_at)).toISOString(),
      };
    },
    async submitAssistantMessage(tx: Tx, input: MessageSubmission, actor: Actor): Promise<AssistantMessage> {
      if (
        !validId(input.conversationId) ||
        !validId(input.clientMessageId) ||
        typeof input.text !== 'string' ||
        input.text.length > 32768
      )
        throw new ApiError('VALIDATION', 400, 'Nội dung gửi không hợp lệ');
      await authorizeSubmission(tx, actor, { conversationId: input.conversationId });
      const selection = normalizeSelection(input.selection),
        read = permission(input.assistantRead);
      if (!input.text.trim() && !selection.attachmentIds.length)
        throw new ApiError('VALIDATION', 400, 'Cần nội dung hoặc tệp');
      const body = {
        conversationId: input.conversationId,
        clientMessageId: input.clientMessageId.toLowerCase(),
        text: input.text,
        selection,
        assistantRead: read,
      };
      const sessionHash = digest(body);
      const prior = await readSubmission(tx, selection, sessionHash, actor, 'message');
      if (prior !== null) return decodeMessage(prior);
      await tx`select pg_advisory_xact_lock(hashtextextended('attachment-owner-quota:owner',0))`;
      await tx`select id from attachment_conversations where id=${input.conversationId} for update`;
      const [client] =
        await tx`select id,canonical_payload_sha256 from attachment_messages where owner_id='owner' and client_message_id=${input.clientMessageId} for update`;
      // UUID reconnect identity precedes fresh compose admission. Verify the
      // immutable original identities, not open state of a historical session.
      if (client) {
        const rows = selection.attachmentIds.length
          ? await tx`select id,expected_sha256 from attachment_uploads where owner_id='owner' and id in ${tx(selection.attachmentIds)} order by id`
          : [];
        if (rows.length !== selection.attachmentIds.length)
          throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy original');
        const refs = rows.map((row) => ({
          attachmentId: String(row.id),
          sha256: String(row.expected_sha256),
          ownerId: 'owner',
        }));
        if (
          client.canonical_payload_sha256 !==
          digest({
            conversationId: input.conversationId,
            text: input.text,
            originals: refs,
            assistantRead: read,
          })
        )
          throw new ApiError('MESSAGE_ALREADY_SUBMITTED', 409, 'Mã tin nhắn đã được sử dụng');
        const [receipt] =
          await tx`select response from attachment_submissions where target_kind='message' and target_id=${client.id}`;
        if (!receipt) throw new Error('MESSAGE_RECEIPT_MISSING');
        return decodeMessage(receipt.response);
      }
      const originals = await selected.lock(tx, selection, actor, {
        purpose: 'assistant_message',
        projectId: null,
        ticketId: null,
        conversationId: input.conversationId,
      });
      const refs = originals.map(({ attachmentId, sha256, ownerId }) => ({ attachmentId, sha256, ownerId }));
      const canonicalHash = digest({
        conversationId: input.conversationId,
        text: input.text,
        originals: refs,
        assistantRead: read,
      });
      const id = randomUUID();
      const [message] =
        await tx`insert into attachment_messages(id,conversation_id,client_message_id,text,canonical_payload_sha256) values(${id},${input.conversationId},${input.clientMessageId},${input.text},${canonicalHash}) returning created_at`;
      for (const original of originals)
        await tx`insert into attachment_message_links(message_id,attachment_id,sha256) values(${id},${original.attachmentId},${original.sha256})`;
      await selected.retain(tx, originals);
      await tx`insert into attachment_input_revisions(target_kind,target_id) values('message',${id})`;
      await selected.authorize(tx, 'message', id, originals, read);
      const response: AssistantMessage = {
        id,
        conversationId: input.conversationId,
        ownerId: 'owner',
        text: input.text,
        attachmentIds: originals.map((o) => o.attachmentId),
        inputRevision: '1',
        routeRevision: 0,
        createdAt: new Date(String(message.created_at)).toISOString(),
      };
      await finishSubmission(tx, selection, sessionHash, 'message', id, response);
      await appendEvent(tx, {
        type: 'assistant.message.created',
        projectId: null,
        ticketId: null,
        audienceMachineId: null,
        data: { messageId: id, inputRevision: '1' },
      });
      return response;
    },
    async persistMessageInputDecision(tx: Tx, input: MessageDecisionInput, actor: Actor): Promise<Id> {
      if (
        !validId(input.messageId) ||
        !/^[1-9]\d*$/.test(input.inputRevision) ||
        !['routing', 'scope', 'reply'].includes(input.kind) ||
        !record(input.body)
      )
        throw new ApiError('VALIDATION', 400, 'Quyết định không hợp lệ');
      if (actor.kind === 'owner') ownerOnly(actor);
      else if (!decisionAuthority)
        throw new ApiError('INPUT_DECISION_NOT_CONFIGURED', 503, 'Chưa cấu hình quyền quyết định');
      const [revision] =
        await tx`select revision from attachment_input_revisions where target_kind='message' and target_id=${input.messageId} for update`;
      const [message] =
        await tx`select input_revision,route_revision from attachment_messages where id=${input.messageId} for update`;
      if (!message) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy tin nhắn');
      if (
        String(message.input_revision) !== input.inputRevision ||
        String(revision?.revision) !== input.inputRevision
      )
        throw new ApiError('INPUT_SNAPSHOT_STALE', 409, 'Input đã thay đổi');
      if (
        actor.kind === 'owner' &&
        input.kind === 'routing' &&
        input.snapshotId === null &&
        input.grantId === null &&
        input.receiptId === null
      ) {
        if (
          !record(input.body.ticket) ||
          !Number.isSafeInteger(input.body.expectedRouteRevision) ||
          input.body.expectedRouteRevision !== Number(message.route_revision)
        )
          throw new ApiError('VALIDATION', 400, 'Quyết định định tuyến không hợp lệ');
      } else {
        if (!decisionAuthority)
          throw new ApiError('INPUT_DECISION_NOT_CONFIGURED', 503, 'Chưa cấu hình quyền quyết định');
        if (actor.kind === 'machine') {
          if (!validId(input.snapshotId) || !validId(input.grantId) || !validId(input.receiptId))
            throw new ApiError('FORBIDDEN', 403, 'Thiếu proof đọc input');
          const [proof] =
            await tx`select g.machine_id,g.input_revision,g.route_revision,g.revoked_at,g.expires_at,g.snapshot_id,r.coverage,s.target_kind,s.target_id,s.input_revision as snapshot_revision from attachment_assistant_grants g join attachment_input_snapshots s on s.id=g.snapshot_id join attachment_assistant_receipts r on r.grant_id=g.id and r.snapshot_id=s.id where g.id=${input.grantId} and r.id=${input.receiptId}`;
          if (
            !proof ||
            proof.machine_id !== actor.id ||
            proof.revoked_at ||
            new Date(String(proof.expires_at)).getTime() <= selected.now().getTime() ||
            proof.snapshot_id !== input.snapshotId ||
            proof.target_kind !== 'message' ||
            proof.target_id !== input.messageId ||
            String(proof.input_revision) !== input.inputRevision ||
            String(proof.snapshot_revision) !== input.inputRevision ||
            Number(proof.route_revision) !== Number(message.route_revision) ||
            proof.coverage !== 'all_selected'
          )
            throw new ApiError('FORBIDDEN', 403, 'Proof đọc input không còn hợp lệ');
        }
        if (
          input.kind === 'scope' &&
          (!Array.isArray(input.body.unitIds) ||
            !input.body.unitIds.every((id) => typeof id === 'string') ||
            typeof input.body.rationale !== 'string' ||
            !input.body.rationale.trim())
        )
          throw new ApiError('VALIDATION', 400, 'Phạm vi cần tập unit và lý do');
        await decisionAuthority(tx, input, actor);
      }
      const id = randomUUID();
      const sha = digest({ ...input, actor });
      await tx`insert into attachment_message_decisions(id,message_id,input_revision,snapshot_id,grant_id,receipt_id,actor_kind,actor_id,kind,body,sha256) values(${id},${input.messageId},${input.inputRevision},${input.snapshotId},${input.grantId},${input.receiptId},${actor.kind},${actor.id},${input.kind},${tx.json(JSON.parse(canonicalJson(input.body)))},${sha})`;
      return id;
    },
  });
}
