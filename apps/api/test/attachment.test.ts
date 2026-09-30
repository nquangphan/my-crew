import { MAX_ATTACHMENT_BYTES } from '@crew/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachments, machines, projects, tickets } from '../src/db/schema.js';
import { createRequestTicket, createSubtask } from '../src/services/ticket-service.js';
import { type PairedMachine, pairTestMachine, setTokenExpiry } from './helpers/machines.js';
import { type LoggedInOwner, makeApp, seedAndLogin } from './helpers/owner-session.js';
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
