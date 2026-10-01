import { randomUUID } from 'node:crypto';
import { MAX_ATTACHMENT_BYTES } from '@crew/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachments, machines, owner as ownerTable, projects, tickets } from '../src/db/schema.js';
import {
  DRAFT_ATTACHMENT_TTL_MS,
  deleteOrphanedDraftAttachments,
} from '../src/services/attachment-service.js';
import { createRequestTicket, createSubtask } from '../src/services/ticket-service.js';
import { type PairedMachine, pairTestMachine, setTokenExpiry } from './helpers/machines.js';
import { type LoggedInOwner, makeApp, OWNER, seedAndLogin } from './helpers/owner-session.js';
import { createTestProject, ORIGIN, RATED, setStatus, useTestDb } from './helpers/test-db.js';

const ctx = useTestDb();
let app: FastifyInstance;
let owner: LoggedInOwner;

beforeEach(async () => {
  app = await makeApp(ctx.db);
  owner = await seedAndLogin(app, ctx.db);
});
afterEach(() => app.close());

const PNG_BYTES = Buffer.from('89504e470d0a1a0a-fake-png-bytes', 'utf8');
const upload = (ticketId: string, body: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `/v1/tickets/${ticketId}/attachments`,
    headers: owner.headers,
    payload: body,
  });
const uploadDraft = (body: Record<string, unknown>, headers: Record<string, string> = owner.headers) =>
  app.inject({ method: 'POST', url: '/v1/attachments', headers, payload: body });
const draftBody = (filename = 'shot.png', mimeType = 'image/png') => ({
  filename,
  mimeType,
  content: PNG_BYTES.toString('base64'),
});

describe('POST /v1/tickets/:id/attachments', () => {
  it.each(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])(
    'stores a %s image and returns id/url/mimeType/sizeBytes',
    async (mimeType) => {
      const ticket = await createRequestTicket(ctx.db, { title: 'Dán ảnh' });
      const res = await upload(ticket.id, {
        filename: 'shot.png',
        mimeType,
        content: PNG_BYTES.toString('base64'),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toMatchObject({ mimeType, sizeBytes: PNG_BYTES.length });
      expect(body.url).toBe(`/v1/attachments/${body.id}`);
      const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, body.id));
      expect(row?.ticketId).toBe(ticket.id);
      expect(row?.content.equals(PNG_BYTES)).toBe(true);
    },
  );

  it('accepts a ticket key, not just its uuid', async () => {
    const ticket = await createRequestTicket(ctx.db, { title: 'Dán ảnh' });
    const res = await upload(ticket.key, {
      filename: 'a.png',
      mimeType: 'image/png',
      content: PNG_BYTES.toString('base64'),
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects an unsupported mime type and stores nothing', async () => {
    const ticket = await createRequestTicket(ctx.db, { title: 'Dán ảnh' });
    const res = await upload(ticket.id, {
      filename: 'doc.pdf',
      mimeType: 'application/pdf',
      content: PNG_BYTES.toString('base64'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    expect(await ctx.db.select().from(attachments)).toHaveLength(0);
  });

  it('rejects an image just over 10MB (still under the route body limit) with a clear size message', async () => {
    const ticket = await createRequestTicket(ctx.db, { title: 'Dán ảnh' });
    const huge = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 1);
    const res = await upload(ticket.id, {
      filename: 'big.png',
      mimeType: 'image/png',
      content: huge.toString('base64'),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toMatchObject({ code: 'ATTACHMENT_TOO_LARGE', message: 'ảnh vượt quá 10MB' });
    expect(await ctx.db.select().from(attachments)).toHaveLength(0);
  });

  it('rejects an image far over 10MB (past the route body limit) with the same clear size message, not a generic error', async () => {
    const ticket = await createRequestTicket(ctx.db, { title: 'Dán ảnh' });
    // 20MB raw: the base64 body is well past `UPLOAD_BODY_LIMIT`, so Fastify itself rejects it before
    // `decodeImage()` ever runs — this must not fall through to the app-wide handler's generic 413/VALIDATION_FAILED.
    const wayTooBig = Buffer.alloc(20 * 1024 * 1024, 1);
    const res = await upload(ticket.id, {
      filename: 'huge.png',
      mimeType: 'image/png',
      content: wayTooBig.toString('base64'),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toMatchObject({ code: 'ATTACHMENT_TOO_LARGE', message: 'ảnh vượt quá 10MB' });
    expect(await ctx.db.select().from(attachments)).toHaveLength(0);
  });

  it('returns 404 for a ticket that does not exist and stores nothing', async () => {
    const res = await upload('AST-999', {
      filename: 'a.png',
      mimeType: 'image/png',
      content: PNG_BYTES.toString('base64'),
    });
    expect(res.statusCode).toBe(404);
    expect(await ctx.db.select().from(attachments)).toHaveLength(0);
  });

  it('needs the owner session and CSRF token', async () => {
    const ticket = await createRequestTicket(ctx.db, { title: 'Dán ảnh' });
    const anonymous = await app.inject({
      method: 'POST',
      url: `/v1/tickets/${ticket.id}/attachments`,
      payload: { filename: 'a.png', mimeType: 'image/png', content: PNG_BYTES.toString('base64') },
    });
    expect(anonymous.statusCode).toBe(401);

    const noCsrf = await app.inject({
      method: 'POST',
      url: `/v1/tickets/${ticket.id}/attachments`,
      headers: { cookie: owner.cookie, origin: ORIGIN },
      payload: { filename: 'a.png', mimeType: 'image/png', content: PNG_BYTES.toString('base64') },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(await ctx.db.select().from(attachments)).toHaveLength(0);
  });
});

describe('GET /v1/attachments/:id', () => {
  it('streams the exact bytes back with the stored Content-Type', async () => {
    const ticket = await createRequestTicket(ctx.db, { title: 'Dán ảnh' });
    const uploaded = await upload(ticket.id, {
      filename: 'shot.gif',
      mimeType: 'image/gif',
      content: PNG_BYTES.toString('base64'),
    });
    const { id } = uploaded.json();

    const res = await app.inject({
      method: 'GET',
      url: `/v1/attachments/${id}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/gif');
    expect(res.rawPayload.equals(PNG_BYTES)).toBe(true);
  });

  it('returns 404 for an unknown attachment', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/attachments/00000000-0000-0000-0000-000000000000',
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('needs the owner session', async () => {
    const ticket = await createRequestTicket(ctx.db, { title: 'Dán ảnh' });
    const uploaded = await upload(ticket.id, {
      filename: 'shot.png',
      mimeType: 'image/png',
      content: PNG_BYTES.toString('base64'),
    });
    const { id } = uploaded.json();
    const anonymous = await app.inject({ method: 'GET', url: `/v1/attachments/${id}` });
    expect(anonymous.statusCode).toBe(401);
  });

  it('rejects a machine token; only an owner session works here', async () => {
    const ticket = await createRequestTicket(ctx.db, { title: 'Dán ảnh' });
    const uploaded = await upload(ticket.id, {
      filename: 'shot.png',
      mimeType: 'image/png',
      content: PNG_BYTES.toString('base64'),
    });
    const { id } = uploaded.json();
    const machine = await pairTestMachine(ctx.db, 'mac-owner-route');
    const res = await app.inject({ method: 'GET', url: `/v1/attachments/${id}`, headers: machine.auth });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /v1/daemon/attachments/:id', () => {
  /** Owns project WEB, holds the dev ticket. */
  let a: PairedMachine;
  /** Owns nothing. */
  let b: PairedMachine;
  /** Hosts the assistant. */
  let host: PairedMachine;
  let devId: string;
  let requestAttachmentId: string;
  let devAttachmentId: string;

  beforeEach(async () => {
    a = await pairTestMachine(ctx.db, 'mac-a');
    b = await pairTestMachine(ctx.db, 'mac-b');
    host = await pairTestMachine(ctx.db, 'mac-host');
    await ctx.db.update(machines).set({ hostsAssistant: true }).where(eq(machines.id, host.machineId));
    const project = await createTestProject(ctx.db, { ownerMachineId: a.machineId });
    const request = await createRequestTicket(ctx.db, { title: 'Thêm giỏ hàng' });
    const pmTask = await createSubtask(ctx.db, {
      type: 'pm_task',
      parentId: request.id,
      projectId: project.id,
      title: 'Phân tích',
    });
    await setStatus(ctx.db, pmTask.id, 'in_progress');
    const dev = await createSubtask(ctx.db, {
      type: 'dev',
      ...RATED,
      parentId: pmTask.id,
      title: 'API',
    });
    devId = dev.id;

    const uploadedOnRequest = await upload(request.id, {
      filename: 'request.png',
      mimeType: 'image/png',
      content: PNG_BYTES.toString('base64'),
    });
    requestAttachmentId = uploadedOnRequest.json().id;
    const uploadedOnDev = await upload(dev.id, {
      filename: 'dev.gif',
      mimeType: 'image/gif',
      content: PNG_BYTES.toString('base64'),
    });
    devAttachmentId = uploadedOnDev.json().id;
  });

  const daemonGet = (machine: PairedMachine, id: string) =>
    app.inject({ method: 'GET', url: `/v1/daemon/attachments/${id}`, headers: machine.auth });

  it('the project-owning machine downloads an attachment on its dev ticket byte-for-byte', async () => {
    const res = await daemonGet(a, devAttachmentId);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/gif');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.rawPayload.equals(PNG_BYTES)).toBe(true);
  });

  it('an attachment on a request: the assistant host and the owning pm_task machine both read it; an unrelated machine gets 403 with no leak', async () => {
    expect((await daemonGet(host, requestAttachmentId)).statusCode).toBe(200);
    const asOwner = await daemonGet(a, requestAttachmentId);
    expect(asOwner.statusCode).toBe(200);
    expect(asOwner.rawPayload.equals(PNG_BYTES)).toBe(true);

    const forbidden = await daemonGet(b, requestAttachmentId);
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe('FORBIDDEN');
    expect(forbidden.headers['content-type']).not.toBe('image/png');
  });

  it('machine B gets 403 (not a leak) on an attachment belonging to project WEB, owned by machine A', async () => {
    const res = await daemonGet(b, devAttachmentId);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    expect(res.headers['content-type']).not.toBe('image/gif');
  });

  it('rejects missing, malformed, expired or revoked machine tokens with 401; an owner session alone is also 401', async () => {
    const noAuth = await app.inject({ method: 'GET', url: `/v1/daemon/attachments/${devAttachmentId}` });
    expect(noAuth.statusCode).toBe(401);

    const badToken = await app.inject({
      method: 'GET',
      url: `/v1/daemon/attachments/${devAttachmentId}`,
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(badToken.statusCode).toBe(401);

    await setTokenExpiry(ctx.db, a.token, new Date(Date.now() - 1_000));
    expect((await daemonGet(a, devAttachmentId)).statusCode).toBe(401);

    const revoke = await app.inject({
      method: 'POST',
      url: `/v1/machines/${b.machineId}/revoke`,
      headers: owner.headers,
    });
    expect(revoke.statusCode).toBe(200);
    expect((await daemonGet(b, devAttachmentId)).statusCode).toBe(401);

    const cookieOnly = await app.inject({
      method: 'GET',
      url: `/v1/daemon/attachments/${devAttachmentId}`,
      headers: { cookie: owner.cookie },
    });
    expect(cookieOnly.statusCode).toBe(401);
  });

  it('returns 404 for an unknown attachment id and 400 (not 500) for a non-uuid id', async () => {
    const notFound = await daemonGet(host, '00000000-0000-0000-0000-000000000000');
    expect(notFound.statusCode).toBe(404);

    const invalid = await daemonGet(host, 'not-a-uuid');
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('project ownership transfer takes effect on the next call: the old owner gets 403, the new owner 200', async () => {
    const c = await pairTestMachine(ctx.db, 'mac-c');
    expect((await daemonGet(a, devAttachmentId)).statusCode).toBe(200);
    expect((await daemonGet(c, devAttachmentId)).statusCode).toBe(403);

    const [devTicket] = await ctx.db.select().from(tickets).where(eq(tickets.id, devId));
    await ctx.db
      .update(projects)
      .set({ ownerMachineId: c.machineId })
      .where(eq(projects.id, devTicket?.projectId as string));

    expect((await daemonGet(a, devAttachmentId)).statusCode).toBe(403);
    expect((await daemonGet(c, devAttachmentId)).statusCode).toBe(200);
  });
});

describe('POST /v1/attachments (draft, before the ticket exists)', () => {
  it.each(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])(
    'stores a %s image with ticket_id null and returns id/url/mimeType/sizeBytes',
    async (mimeType) => {
      const res = await uploadDraft(draftBody('shot.png', mimeType));
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toMatchObject({ mimeType, sizeBytes: PNG_BYTES.length });
      expect(body.url).toBe(`/v1/attachments/${body.id}`);
      const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, body.id));
      expect(row?.ticketId).toBeNull();
      expect(row?.content.equals(PNG_BYTES)).toBe(true);

      const get = await app.inject({
        method: 'GET',
        url: body.url,
        headers: { cookie: owner.cookie },
      });
      expect(get.statusCode).toBe(200);
      expect(get.headers['content-type']).toBe(mimeType);
      expect(get.rawPayload.equals(PNG_BYTES)).toBe(true);
    },
  );

  it('rejects an unsupported mime type and stores nothing', async () => {
    const res = await uploadDraft({
      filename: 'doc.pdf',
      mimeType: 'application/pdf',
      content: PNG_BYTES.toString('base64'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    expect(await ctx.db.select().from(attachments)).toHaveLength(0);
  });

  it('rejects an image just over 10MB with a clear size message', async () => {
    const huge = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 1);
    const res = await uploadDraft({
      filename: 'big.png',
      mimeType: 'image/png',
      content: huge.toString('base64'),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toMatchObject({ code: 'ATTACHMENT_TOO_LARGE', message: 'ảnh vượt quá 10MB' });
    expect(await ctx.db.select().from(attachments)).toHaveLength(0);
  });

  it('rejects an image far over 10MB (past the route body limit) with the same clear size message', async () => {
    const wayTooBig = Buffer.alloc(20 * 1024 * 1024, 1);
    const res = await uploadDraft({
      filename: 'huge.png',
      mimeType: 'image/png',
      content: wayTooBig.toString('base64'),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toMatchObject({ code: 'ATTACHMENT_TOO_LARGE', message: 'ảnh vượt quá 10MB' });
    expect(await ctx.db.select().from(attachments)).toHaveLength(0);
  });

  it('needs the owner session and CSRF token', async () => {
    const anonymous = await app.inject({ method: 'POST', url: '/v1/attachments', payload: draftBody() });
    expect(anonymous.statusCode).toBe(401);

    const noCsrf = await app.inject({
      method: 'POST',
      url: '/v1/attachments',
      headers: { cookie: owner.cookie, origin: ORIGIN },
      payload: draftBody(),
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(await ctx.db.select().from(attachments)).toHaveLength(0);
  });
});

describe('creating a request ticket claims referenced draft attachments', () => {
  async function ownerId(): Promise<string> {
    const [row] = await ctx.db
      .select({ id: ownerTable.id })
      .from(ownerTable)
      .where(eq(ownerTable.username, OWNER.username));
    if (!row) throw new Error('seeded owner not found');
    return row.id;
  }

  it('sets ticket_id on every draft attachment referenced in the new description, in the same transaction', async () => {
    const a = (await uploadDraft(draftBody('a.png'))).json();
    const b = (await uploadDraft(draftBody('b.png', 'image/gif'))).json();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: owner.headers,
      payload: { title: 'Có ảnh', description: `Xem ${a.url} và ${b.url}` },
    });
    expect(res.statusCode).toBe(201);
    const ticket = res.json();

    const rows = await ctx.db.select().from(attachments).where(eq(attachments.ticketId, ticket.id));
    expect(rows.map((row) => row.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('leaves an unreferenced draft attachment with ticket_id null', async () => {
    const referenced = (await uploadDraft(draftBody('a.png'))).json();
    const untouched = (await uploadDraft(draftBody('b.png'))).json();
    await app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: owner.headers,
      payload: { title: 'Chỉ 1 ảnh', description: `Xem ${referenced.url}` },
    });

    const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, untouched.id));
    expect(row?.ticketId).toBeNull();
  });

  it('ignores an unknown attachment id in the description without failing ticket creation', async () => {
    const unknownUrl = `/v1/attachments/${randomUUID()}`;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: owner.headers,
      payload: { title: 'Id lạ', description: `Xem ${unknownUrl}` },
    });
    expect(res.statusCode).toBe(201);
  });

  it('does not steal an attachment already claimed by another ticket', async () => {
    const other = await createRequestTicket(ctx.db, { title: 'Ticket khác' });
    const claimed = (
      await upload(other.id, {
        filename: 'x.png',
        mimeType: 'image/png',
        content: PNG_BYTES.toString('base64'),
      })
    ).json();

    await app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: owner.headers,
      payload: { title: 'Nhắc lại ảnh cũ', description: `Xem ${claimed.url}` },
    });

    const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, claimed.id));
    expect(row?.ticketId).toBe(other.id);
  });

  it('does not claim a draft attachment belonging to a different owner', async () => {
    const [otherOwner] = await ctx.db
      .insert(ownerTable)
      .values({ username: `other-${randomUUID()}`, passwordHash: 'x', totpSecret: '' })
      .returning({ id: ownerTable.id });
    if (!otherOwner) throw new Error('other owner insert failed');
    const [row] = await ctx.db
      .insert(attachments)
      .values({
        ticketId: null,
        ownerId: otherOwner.id,
        filename: 'other-owner.png',
        mimeType: 'image/png',
        sizeBytes: PNG_BYTES.length,
        content: PNG_BYTES,
      })
      .returning({ id: attachments.id });
    if (!row) throw new Error('insert failed');

    const ticket = await createRequestTicket(
      ctx.db,
      { title: 'Ảnh của owner khác', description: `Xem /v1/attachments/${row.id}` },
      await ownerId(),
    );

    const [after] = await ctx.db.select().from(attachments).where(eq(attachments.id, row.id));
    expect(after?.ticketId).toBeNull();
    expect(ticket.id).toBeDefined();
  });

  it('claims nothing when ticket creation itself fails (same transaction as the insert)', async () => {
    const draft = (await uploadDraft(draftBody('a.png'))).json();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: owner.headers,
      payload: { title: 'Hint sai', description: `Xem ${draft.url}`, projectHintId: randomUUID() },
    });
    expect(res.statusCode).toBe(404);

    const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, draft.id));
    expect(row?.ticketId).toBeNull();
  });
});

describe('deleteOrphanedDraftAttachments', () => {
  async function age(id: string, ms: number): Promise<void> {
    await ctx.db.execute(
      sql`update attachments set created_at = now() - make_interval(secs => ${ms / 1000}) where id = ${id}`,
    );
  }

  it('deletes a draft attachment unclaimed for longer than the TTL', async () => {
    const draft = (await uploadDraft(draftBody())).json();
    await age(draft.id, DRAFT_ATTACHMENT_TTL_MS + 60_000);

    const deleted = await deleteOrphanedDraftAttachments(ctx.db);
    expect(deleted).toEqual([draft.id]);
    expect(await ctx.db.select().from(attachments)).toHaveLength(0);
  });

  it('keeps a draft attachment still within the TTL', async () => {
    const draft = (await uploadDraft(draftBody())).json();
    await age(draft.id, DRAFT_ATTACHMENT_TTL_MS - 60_000);

    expect(await deleteOrphanedDraftAttachments(ctx.db)).toEqual([]);
    expect(await ctx.db.select().from(attachments)).toHaveLength(1);
  });

  it('never deletes an attachment claimed by a ticket, no matter how old', async () => {
    const ticket = await createRequestTicket(ctx.db, { title: 'Dán ảnh' });
    const attached = await upload(ticket.id, {
      filename: 'shot.png',
      mimeType: 'image/png',
      content: PNG_BYTES.toString('base64'),
    });
    const { id } = attached.json();
    await age(id, DRAFT_ATTACHMENT_TTL_MS + 60_000);

    expect(await deleteOrphanedDraftAttachments(ctx.db)).toEqual([]);
    expect(await ctx.db.select().from(attachments)).toHaveLength(1);
  });
});
