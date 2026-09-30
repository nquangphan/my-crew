import { MAX_ATTACHMENT_BYTES } from '@crew/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachments } from '../src/db/schema.js';
import { createRequestTicket } from '../src/services/ticket-service.js';
import { type LoggedInOwner, makeApp, seedAndLogin } from './helpers/owner-session.js';
import { ORIGIN, useTestDb } from './helpers/test-db.js';

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
});
