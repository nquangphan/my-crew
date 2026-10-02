import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from '../journal/canonical.ts';
import { appendEvent } from '../journal/events.ts';
import { mutate } from '../journal/mutation.ts';
import type { Actor, Db, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type { AttachmentConfig } from './config.ts';
import type {
  Attachment,
  ComposeSession,
  ReceiverRegistration,
  StageFactoryInput,
  StageServices,
} from './contracts.ts';
import type { ManagedReceiverRegistry } from './receivers.ts';
import type { StorageFault } from './storage.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/;
const binaryMime: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const textMimes = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/yaml',
  'text/yaml',
  'text/javascript',
  'application/javascript',
  'text/css',
  'text/html',
  'application/xml',
  'text/xml',
  'application/x-sh',
  'text/x-python',
]);
const textExt = new Set([
  'csv',
  'txt',
  'md',
  'json',
  'yaml',
  'yml',
  'ts',
  'js',
  'py',
  'sh',
  'css',
  'html',
  'xml',
  'log',
]);
function ownerOnly(actor: Actor): void {
  if (actor.kind !== 'owner' || actor.id !== 'owner')
    throw new ApiError('OWNER_REQUIRED', 403, 'Chỉ chủ dự án được thao tác tệp');
}
function safeName(value: string): string {
  if (
    typeof value !== 'string' ||
    !value ||
    [...value].length > 255 ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    value.includes('/') ||
    value.includes('\\') ||
    value === '.' ||
    value === '..'
  )
    throw new ApiError('ATTACHMENT_FILE_NAME_INVALID', 400, 'Tên tệp không hợp lệ');
  return value;
}
function extension(name: string): string {
  return name.slice(name.lastIndexOf('.') + 1).toLowerCase();
}
function assertType(name: string, mime: string, allowed: string[]): void {
  const ext = extension(name);
  if (!allowed.includes(ext)) throw new ApiError('ATTACHMENT_TYPE_UNSUPPORTED', 415, 'Loại tệp chưa hỗ trợ');
  if (binaryMime[ext]) {
    if (mime !== binaryMime[ext]) throw new ApiError('ATTACHMENT_MIME_MISMATCH', 415, 'Loại tệp không khớp');
  } else if (!textExt.has(ext) || !textMimes.has(mime))
    throw new ApiError('ATTACHMENT_MIME_MISMATCH', 415, 'Loại tệp không khớp');
}
function detect(sample: Uint8Array, declared: string, fileName: string): string {
  const b = Buffer.from(sample);
  const starts = (hex: string) => b.subarray(0, hex.length / 2).toString('hex') === hex;
  const detected = starts('89504e470d0a1a0a')
    ? 'image/png'
    : starts('ffd8ff')
      ? 'image/jpeg'
      : b.subarray(0, 5).toString() === '%PDF-'
        ? 'application/pdf'
        : starts('504b0304')
          ? 'application/zip'
          : starts('d0cf11e0a1b11ae1')
            ? 'application/x-ole-storage'
            : 'text/plain';
  const ext = extension(fileName);
  if (binaryMime[ext]) {
    if (ext === 'docx' || ext === 'xlsx') {
      if (!['application/zip', 'application/x-ole-storage'].includes(detected))
        throw new ApiError('ATTACHMENT_MAGIC_MISMATCH', 415, 'Nội dung tệp không khớp');
    } else if (detected !== declared)
      throw new ApiError('ATTACHMENT_MAGIC_MISMATCH', 415, 'Nội dung tệp không khớp');
  } else if (detected !== 'text/plain')
    throw new ApiError('ATTACHMENT_MAGIC_MISMATCH', 415, 'Nội dung tệp không khớp');
  if (
    detected === 'text/plain' &&
    b.includes(0) &&
    !(b[0] === 0xff && b[1] === 0xfe) &&
    !(b[0] === 0xfe && b[1] === 0xff)
  )
    throw new ApiError('ATTACHMENT_BINARY_TEXT', 415, 'Nội dung tệp không khớp');
  return detected === 'application/zip' ? declared : detected;
}
function mapSession(row: Record<string, unknown>): ComposeSession {
  return {
    id: String(row.id),
    ownerId: 'owner',
    purpose: row.purpose as ComposeSession['purpose'],
    projectId: row.project_id as Id | null,
    ticketId: row.ticket_id as Id | null,
    ...(row.conversation_id ? { conversationId: String(row.conversation_id) } : {}),
    revision: Number(row.revision),
    state: row.state as ComposeSession['state'],
    expiresAt: (row.expires_at as Date).toISOString(),
  } as ComposeSession;
}
function mapAttachment(row: Record<string, unknown>): Attachment {
  return {
    attachmentId: String(row.id),
    composeSessionId: String(row.compose_id),
    sha256: String(row.expected_sha256),
    ownerId: 'owner',
    fileName: String(row.file_name),
    mime: row.detected_mime as string | null,
    byteLength: Number(row.expected_bytes),
    state: row.state as Attachment['state'],
    extraction: 'pending',
    problems: row.rejection_code
      ? [{ code: String(row.rejection_code), message: 'Tệp không hợp lệ', unitIds: [] }]
      : [],
  };
}
async function ownCompose(tx: Tx | Db, id: Id, actor: Actor, lock = false): Promise<Record<string, unknown>> {
  ownerOnly(actor);
  if (!uuid.test(id)) throw new ApiError('ATTACHMENT_NOT_FOUND', 404, 'Không tìm thấy lượt gửi');
  if (lock) {
    const [scope] =
      await tx`select project_id,ticket_id,conversation_id from attachment_compose_sessions where id=${id} and owner_id='owner'`;
    if (!scope) throw new ApiError('ATTACHMENT_NOT_FOUND', 404, 'Không tìm thấy lượt gửi');
    if (scope.ticket_id) {
      const [ticket] = await tx`select root_id from tickets where id=${scope.ticket_id}`;
      if (!ticket) throw new ApiError('ATTACHMENT_NOT_FOUND', 404, 'Không tìm thấy ticket');
      await tx`select id from tickets where id=${ticket.root_id} for update`;
      await tx`select id from tickets where id=${scope.ticket_id} for update`;
    }
    if (scope.project_id) await tx`select id from projects where id=${scope.project_id} for share`;
    if (scope.conversation_id)
      await tx`select id from attachment_conversations where id=${scope.conversation_id} for update`;
  }
  const [row] = lock
    ? await tx`select * from attachment_compose_sessions where id=${id} and owner_id='owner' for update`
    : await tx`select * from attachment_compose_sessions where id=${id} and owner_id='owner'`;
  if (!row) throw new ApiError('ATTACHMENT_NOT_FOUND', 404, 'Không tìm thấy lượt gửi');
  return row;
}
export function createStageServices(input: StageFactoryInput & { fault?: StorageFault }): StageServices {
  const { db, store, receivers, config, now } = input;
  const control = (receivers as Partial<ManagedReceiverRegistry>).control;
  const { storageRoot: _storageRoot, ...acceptedPolicy } = config;
  const fault = input.fault ?? (async () => {});
  return {
    async createCompose(tx, target, actor) {
      ownerOnly(actor);
      const id = randomUUID();
      if (target.purpose === 'assistant_message') {
        const [c] =
          await tx`select id from attachment_conversations where id=${target.conversationId} and owner_id='owner'`;
        if (!c) throw new ApiError('ATTACHMENT_TARGET_NOT_FOUND', 404, 'Không tìm thấy hội thoại');
      } else {
        if (target.purpose === 'comment') {
          const [t] =
            await tx`select id,root_id from tickets where id=${target.ticketId} and project_id=${target.projectId}`;
          if (!t) throw new ApiError('ATTACHMENT_TARGET_NOT_FOUND', 404, 'Không tìm thấy ticket');
          await tx`select id from tickets where id=${t.root_id} for update`;
          await tx`select id from tickets where id=${target.ticketId} for update`;
        }
        const [p] = await tx`select id from projects where id=${target.projectId} for share`;
        if (!p) throw new ApiError('ATTACHMENT_TARGET_NOT_FOUND', 404, 'Không tìm thấy dự án');
      }
      const expires = new Date(now().getTime() + config.stagingTtlMs);
      await tx`insert into attachment_compose_sessions(id,owner_id,project_id,ticket_id,conversation_id,purpose,state,revision,expires_at) values(${id},'owner',${target.projectId},${target.ticketId},${target.purpose === 'assistant_message' ? target.conversationId : null},${target.purpose},'open',1,${expires})`;
      return {
        id,
        ownerId: 'owner',
        ...target,
        revision: 1,
        state: 'open',
        expiresAt: expires.toISOString(),
      } as ComposeSession;
    },
    async reserve(tx, spec, actor) {
      ownerOnly(actor);
      safeName(spec.fileName);
      assertType(spec.fileName, spec.declaredMime, config.allowedExtensions);
      if (
        !Number.isSafeInteger(spec.byteLength) ||
        spec.byteLength < 0 ||
        spec.byteLength > config.maxFileBytes ||
        !hash.test(spec.sha256)
      )
        throw new ApiError('ATTACHMENT_LIMIT_INVALID', 413, 'Tệp vượt giới hạn hoặc checksum sai');
      await tx`select pg_advisory_xact_lock(hashtextextended('attachment-owner-quota:owner',0))`;
      const compose = await ownCompose(tx, spec.composeSessionId, actor, true);
      if (compose.state !== 'open' || (compose.expires_at as Date) <= now())
        throw new ApiError('ATTACHMENT_COMPOSE_CLOSED', 409, 'Lượt gửi đã đóng');
      if (Number(compose.revision) !== spec.expectedRevision)
        throw new ApiError('ATTACHMENT_SELECTION_STALE', 409, 'Danh sách tệp đã thay đổi');
      const [total] =
        await tx`select count(*)::int as files,coalesce(sum(expected_bytes),0)::bigint as bytes from attachment_uploads where compose_id=${spec.composeSessionId} and state not in ('abandoned','deleted')`;
      if (
        Number(total.files) >= config.maxComposeFiles ||
        Number(total.bytes) + spec.byteLength > config.maxComposeBytes
      )
        throw new ApiError('ATTACHMENT_COMPOSE_QUOTA', 413, 'Lượt gửi vượt giới hạn');
      const [ownerQuota] =
        await tx`select coalesce(sum(expected_bytes),0)::bigint as bytes from attachment_uploads where owner_id='owner' and quota_released_at is null`;
      if (Number(ownerQuota.bytes) + spec.byteLength > config.maxOwnerStagingBytes)
        throw new ApiError('ATTACHMENT_OWNER_QUOTA', 413, 'Dung lượng tạm đã đầy');
      const id = randomUUID(),
        key = `uploads/${id}/original`;
      const [row] =
        await tx`insert into attachment_uploads(id,compose_id,initial_project_id,owner_id,file_name,declared_mime,expected_bytes,expected_sha256,storage_key,ownership_nonce,policy_sha256,accepted_config,state,expires_at) values(${id},${spec.composeSessionId},${compose.project_id as Id | null},'owner',${spec.fileName},${spec.declaredMime},${spec.byteLength},${spec.sha256},${key},${randomUUID()},${config.policySha256},${tx.json(JSON.parse(canonicalJson(acceptedPolicy)))},'reserved',${compose.expires_at as Date}) returning *`;
      const [updated] =
        await tx`update attachment_compose_sessions set revision=revision+1 where id=${spec.composeSessionId} returning revision`;
      if (!row || !updated) throw new Error('ATTACHMENT_RESERVATION_MISSING');
      return { attachment: mapAttachment(row), selectionRevision: Number(updated.revision) };
    },
    async receive(id, actor, body, signal) {
      ownerOnly(actor);
      if (!uuid.test(id)) throw new ApiError('ATTACHMENT_NOT_FOUND', 404, 'Không tìm thấy tệp');
      if (!control)
        throw new ApiError('ATTACHMENT_RECEIVER_NOT_CONFIGURED', 503, 'Bộ nhận tệp chưa sẵn sàng');
      const started = await mutate<{ row: Record<string, unknown>; receiver: ReceiverRegistration | null }>(
        db,
        { actor, route: 'attachment:receive:start', key: randomUUID(), body: { attachmentId: id } },
        async (tx) => {
          const [scope] =
            await tx`select compose_id from attachment_uploads where id=${id} and owner_id='owner'`;
          if (!scope) throw new ApiError('ATTACHMENT_NOT_FOUND', 404, 'Không tìm thấy tệp');
          const compose = await ownCompose(tx, String(scope.compose_id), actor, true);
          const [row] =
            await tx`select * from attachment_uploads where id=${id} and owner_id='owner' for update`;
          if (!row) throw new ApiError('ATTACHMENT_NOT_FOUND', 404, 'Không tìm thấy tệp');
          if (row.state === 'ready')
            return {
              status: 200,
              body: { row: JSON.parse(JSON.stringify(row)) as Record<string, unknown>, receiver: null },
            };
          if (row.state === 'receiving')
            throw new ApiError('ATTACHMENT_UPLOAD_BUSY', 409, 'Tệp đang được nhận');
          if (row.state !== 'reserved' || compose.state !== 'open')
            throw new ApiError('ATTACHMENT_UPLOAD_CONFLICT', 409, 'Tệp không còn nhận dữ liệu');
          if ((row.expires_at as Date) <= now())
            throw new ApiError('ATTACHMENT_UPLOAD_EXPIRED', 409, 'Lượt gửi đã hết hạn');
          const generation = String(BigInt(String(row.generation)) + 1n);
          const receiver = await receivers.register(tx, id, generation);
          await tx`update attachment_uploads set state='receiving',generation=${generation},receiver_id=${receiver.id},stage_key=${receiver.stageKey},receive_lease_until=${new Date(now().getTime() + config.uploadLeaseMs)} where id=${id} and state='reserved'`;
          return {
            status: 200,
            body: {
              row: JSON.parse(
                JSON.stringify({
                  ...row,
                  generation,
                  stage_key: receiver.stageKey,
                  receiver_id: receiver.id,
                }),
              ) as Record<string, unknown>,
              receiver,
            },
          };
        },
      );
      const begin = started.body;
      const row = begin.row as Record<string, unknown>;
      const original = {
        key: String(row.storage_key),
        sha256: String(row.expected_sha256),
        byteLength: Number(row.expected_bytes),
      };
      if (!begin.receiver) {
        // Binary retry identity includes the complete bytes, never just the upload UUID.
        const h = createHash('sha256');
        let count = 0;
        for await (const chunk of body) {
          if (signal.aborted) throw new ApiError('ATTACHMENT_ABORTED', 409, 'Tải tệp bị hủy');
          if (!(chunk instanceof Uint8Array))
            throw new ApiError('ATTACHMENT_CONTENT_INVALID', 400, 'Dữ liệu tải lên không hợp lệ');
          count += chunk.byteLength;
          if (count > original.byteLength)
            throw new ApiError('ATTACHMENT_REPLAY_MISMATCH', 409, 'Dữ liệu gửi lại khác');
          h.update(chunk);
        }
        if (signal.aborted || count !== original.byteLength || h.digest('hex') !== original.sha256)
          throw new ApiError('ATTACHMENT_REPLAY_MISMATCH', 409, 'Dữ liệu gửi lại khác');
        if ((await store.verify(original)) !== 'present')
          throw new ApiError('ATTACHMENT_DATA_LOSS', 409, 'Tệp gốc không khả dụng');
        return mapAttachment(row);
      }
      const receiver = begin.receiver;
      const abort = new AbortController();
      const combined = AbortSignal.any([signal, abort.signal]);
      const accepted = row.accepted_config as AttachmentConfig;
      let stopped = false;
      let heartbeat: ReturnType<typeof setTimeout> | undefined;
      let pending: Promise<void> = Promise.resolve();
      const expires = Date.now() + accepted.uploadMaxWallMs;
      const wall = setTimeout(() => abort.abort(new Error('UPLOAD_WALL_LIMIT')), accepted.uploadMaxWallMs);
      wall.unref();
      async function currentWriter(renew = false): Promise<void> {
        const [live] =
          await db`select u.generation,u.receiver_id,u.state,r.abort_requested from attachment_uploads u join attachment_receivers r on r.id=u.receiver_id where u.id=${id}`;
        if (
          !live ||
          String(live.generation) !== receiver.generation ||
          live.receiver_id !== receiver.id ||
          live.state !== 'receiving' ||
          live.abort_requested ||
          Date.now() >= expires
        )
          throw new ApiError('ATTACHMENT_UPLOAD_CONFLICT', 409, 'Lượt nhận đã bị thu hồi');
        if (renew)
          await db`update attachment_uploads set receive_lease_until=${new Date(now().getTime() + accepted.uploadLeaseMs)} where id=${id} and generation=${receiver.generation} and receiver_id=${receiver.id} and state='receiving'`;
      }
      function schedule() {
        heartbeat = setTimeout(() => {
          pending = (async () => {
            try {
              await currentWriter(true);
            } catch (error) {
              abort.abort(error);
            } finally {
              if (!stopped && !abort.signal.aborted) schedule();
            }
          })();
        }, accepted.uploadHeartbeatMs);
        heartbeat.unref();
      }
      schedule();
      let mime: string | null = null;
      try {
        const blob = await control.run(receiver.id, combined, async (writerSignal) => {
          const sample: Uint8Array[] = [];
          let sampled = 0;
          let decoder: TextDecoder | undefined;
          let prefix = Buffer.alloc(0);
          const isText = textExt.has(extension(String(row.file_name)));
          async function* checkedBody() {
            try {
              for await (const chunk of body) {
                if (writerSignal.aborted) throw new ApiError('ATTACHMENT_ABORTED', 409, 'Tải tệp bị hủy');
                if (!(chunk instanceof Uint8Array))
                  throw new ApiError('ATTACHMENT_CONTENT_INVALID', 400, 'Dữ liệu tải lên không hợp lệ');
                if (sampled < 512) {
                  const part = Buffer.from(chunk.subarray(0, 512 - sampled));
                  sample.push(part);
                  sampled += part.length;
                }
                if (isText) {
                  let decode = Buffer.from(chunk);
                  if (!decoder) {
                    prefix = Buffer.concat([prefix, decode]);
                    if (prefix.length >= 2) {
                      decoder = new TextDecoder(
                        prefix[0] === 0xff && prefix[1] === 0xfe
                          ? 'utf-16le'
                          : prefix[0] === 0xfe && prefix[1] === 0xff
                            ? 'utf-16be'
                            : 'utf-8',
                        { fatal: true },
                      );
                      decode = prefix;
                      prefix = Buffer.alloc(0);
                    } else decode = Buffer.alloc(0);
                  }
                  if (decoder)
                    for (let offset = 0; offset < decode.length; offset += accepted.chunkBytes) {
                      const text = decoder.decode(decode.subarray(offset, offset + accepted.chunkBytes), {
                        stream: true,
                      });
                      if (
                        [...text].some(
                          (char) => char.charCodeAt(0) < 32 && ![9, 10, 13].includes(char.charCodeAt(0)),
                        )
                      )
                        throw new ApiError('ATTACHMENT_BINARY_TEXT', 415, 'Nội dung tệp không khớp');
                    }
                }
                yield chunk;
              }
              if (isText) {
                if (!decoder) decoder = new TextDecoder('utf-8', { fatal: true });
                decoder.decode(prefix, { stream: true });
                decoder.decode();
              }
            } catch (error) {
              if (error instanceof TypeError)
                throw new ApiError('ATTACHMENT_BINARY_TEXT', 415, 'Nội dung tệp không khớp');
              throw error;
            }
            mime = detect(Buffer.concat(sample), String(row.declared_mime), String(row.file_name));
            // This check precedes the exclusive publication; a replacement writer cannot
            // take over the operation until this writer has an actual stop proof.
            await currentWriter();
          }
          return store.receive(
            {
              attachmentId: id,
              generation: `${receiver.generation}.${receiver.id}`,
              expectedBytes: original.byteLength,
              expectedSha256: original.sha256,
            },
            checkedBody(),
            writerSignal,
          );
        });
        if (combined.aborted) throw new ApiError('ATTACHMENT_ABORTED', 409, 'Tải tệp bị hủy');
        const proof = await receivers.closeAndAcknowledge(receiver.id);
        await fault('before-ready-commit');
        const result = await mutate(
          db,
          {
            actor,
            route: 'attachment:receive:finalize',
            key: `${id}:${receiver.generation}:${receiver.id}`,
            body: { attachmentId: id, generation: receiver.generation, receiverId: receiver.id },
          },
          async (tx) => {
            const compose = await ownCompose(tx, String(row.compose_id), actor, true);
            const [live] = await tx`select * from attachment_uploads where id=${id} for update`;
            const [receiverRow] =
              await tx`select state,abort_requested,closed_ack_sha256 from attachment_receivers where id=${receiver.id} for update`;
            if (
              combined.aborted ||
              compose.state !== 'open' ||
              !live ||
              live.state !== 'receiving' ||
              String(live.generation) !== receiver.generation ||
              live.receiver_id !== receiver.id ||
              receiverRow?.state !== 'closed' ||
              receiverRow.abort_requested ||
              receiverRow.closed_ack_sha256 !== proof.proofSha256
            )
              throw new ApiError('ATTACHMENT_UPLOAD_CONFLICT', 409, 'Lượt nhận đã bị thu hồi');
            if ((await store.verify(blob)) !== 'present')
              throw new ApiError('ATTACHMENT_DATA_LOSS', 409, 'Tệp gốc không khả dụng');
            const [ready] =
              await tx`update attachment_uploads set state='ready',detected_mime=${mime},durable_at=${now()},receive_lease_until=null where id=${id} and generation=${receiver.generation} and receiver_id=${receiver.id} returning *`;
            // Drafts have no live project link and remain owner-only. This schema must be
            // registered by the controller; missing producer metadata rolls back readiness.
            const links =
              await tx`select project_id,ticket_id from attachment_links where attachment_id=${id} and revoked_at is null order by id`;
            const scopes = links.length ? links : [{ project_id: null, ticket_id: null }];
            for (const scope of scopes)
              await appendEvent(tx, {
                type: 'attachment.changed',
                projectId: scope.project_id as Id | null,
                ticketId: scope.ticket_id as Id | null,
                audienceMachineId: null,
                data: { attachmentId: id, state: 'ready', extraction: 'pending' },
              });
            return {
              status: 200,
              body: mapAttachment(
                ready ??
                  (() => {
                    throw new Error('ATTACHMENT_READY_MISSING');
                  })(),
              ),
            };
          },
        );
        return result.body;
      } catch (error) {
        // A durable original with a failed ready commit is retained with its intent.
        // A failed stream is only rejected after actual terminal closure; quota stays held.
        try {
          const proof = await receivers.closeAndAcknowledge(receiver.id);
          if ((await store.verify(original)) !== 'present') {
            await db`update attachment_uploads set state='rejected',rejection_code=${error instanceof ApiError ? error.code : 'UPLOAD_FAILED'},receive_lease_until=null where id=${id} and generation=${receiver.generation} and receiver_id=${receiver.id} and state='receiving' and exists(select 1 from attachment_receivers where id=${receiver.id} and closed_ack_sha256=${proof.proofSha256})`;
          }
        } catch {
          /* unknown writer remains receiving and counted until recovery proves stop */
        }
        throw error;
      } finally {
        stopped = true;
        clearTimeout(wall);
        if (heartbeat) clearTimeout(heartbeat);
        await pending;
      }
    },
    async abandonUpload(tx, selection, actor) {
      const compose = await ownCompose(tx, selection.composeSessionId, actor, true);
      if (compose.state !== 'open' || Number(compose.revision) !== selection.expectedRevision)
        throw new ApiError('ATTACHMENT_SELECTION_STALE', 409, 'Danh sách tệp đã thay đổi');
      const [row] =
        await tx`select * from attachment_uploads where id=${selection.attachmentId} and compose_id=${selection.composeSessionId} for update`;
      if (
        !row ||
        row.linked_at ||
        !['reserved', 'receiving', 'ready', 'rejected'].includes(String(row.state))
      )
        throw new ApiError('ATTACHMENT_UPLOAD_CONFLICT', 409, 'Tệp không thể bỏ');
      if (row.receiver_id) await receivers.requestAbort(tx, String(row.receiver_id));
      await tx`update attachment_uploads set state='abandoned',abandoned_at=${now()} where id=${selection.attachmentId}`;
      const [updated] =
        await tx`update attachment_compose_sessions set revision=revision+1 where id=${selection.composeSessionId} returning revision`;
      return Number(updated?.revision);
    },
    async abandonCompose(tx, selection, actor) {
      const compose = await ownCompose(tx, selection.composeSessionId, actor, true);
      if (compose.state !== 'open' || Number(compose.revision) !== selection.expectedRevision)
        throw new ApiError('ATTACHMENT_SELECTION_STALE', 409, 'Danh sách tệp đã thay đổi');
      const active =
        await tx`select receiver_id,linked_at from attachment_uploads where compose_id=${selection.composeSessionId} order by id for update`;
      if (active.some((row) => row.linked_at))
        throw new ApiError('ATTACHMENT_UPLOAD_CONFLICT', 409, 'Tệp đã được liên kết');
      for (const row of active)
        if (row.receiver_id) await receivers.requestAbort(tx, String(row.receiver_id));
      await tx`update attachment_uploads set state='abandoned',abandoned_at=${now()} where compose_id=${selection.composeSessionId} and state in ('reserved','receiving','ready','rejected')`;
      const [updated] =
        await tx`update attachment_compose_sessions set state='abandoned',revision=revision+1 where id=${selection.composeSessionId} returning *`;
      return mapSession(
        updated ??
          (() => {
            throw new Error('ATTACHMENT_COMPOSE_MISSING');
          })(),
      );
    },
    async readCompose(client, id, actor) {
      const row = await ownCompose(client, id, actor);
      const uploads =
        await client`select * from attachment_uploads where compose_id=${id} and state<>'deleted' order by created_at,id`;
      return { session: mapSession(row), attachments: uploads.map(mapAttachment) };
    },
  };
}
