import { CSRF_HEADER } from '@crew/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { csrfTokenFor } from '../src/auth/csrf.js';
import { type LoggedInOwner, makeApp, OWNER, seedAndLogin } from './helpers/owner-session.js';
import { ORIGIN, testConfig, useTestDb } from './helpers/test-db.js';

const ctx = useTestDb();
let app: FastifyInstance;
let session: LoggedInOwner;

beforeEach(async () => {
  app = await makeApp(ctx.db);
  session = await seedAndLogin(app, ctx.db);
});
afterEach(() => app.close());

const createTicket = (headers: Record<string, string>) =>
  app.inject({ method: 'POST', url: '/v1/tickets', headers, payload: { title: 'Yêu cầu mới' } });

describe('CSRF protection on owner routes', () => {
  it('accepts a mutating request with the session, an allowed Origin and the CSRF token', async () => {
    const res = await createTicket(session.headers);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ key: 'AST-1', type: 'request' });
  });

  it('rejects a request without the CSRF token', async () => {
    const res = await createTicket({ cookie: session.cookie, origin: ORIGIN });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF_FAILED');
  });

  it('rejects a token that does not match the cookie', async () => {
    const res = await createTicket({ ...session.headers, [CSRF_HEADER]: `${session.csrfToken}x` });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a matching header and cookie pair that is not bound to the session', async () => {
    const forged = csrfTokenFor(testConfig().sessionSecret, 'another-session');
    const cookie = session.cookie.replace(/crew_csrf=[^;]+/, `crew_csrf=${forged}`);
    const res = await createTicket({ cookie, origin: ORIGIN, [CSRF_HEADER]: forged });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a missing or foreign Origin', async () => {
    const { origin: _omit, ...withoutOrigin } = session.headers;
    expect((await createTicket(withoutOrigin)).statusCode).toBe(403);
    const foreign = await createTicket({ ...session.headers, origin: 'https://evil.example' });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().error.code).toBe('CSRF_FAILED');
  });

  it('lets safe reads through without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/tickets', headers: { cookie: session.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], nextCursor: null });
  });

  it('checks the Origin on login too', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: OWNER,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('owner routes end to end', () => {
  it('manages projects, tickets, comments, reports and search over HTTP', async () => {
    const project = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: session.headers,
      payload: {
        key: 'SHOP',
        name: 'Shop',
        description: 'Ứng dụng bán hàng',
        repoUrl: 'git@github.com:2p/shop.git',
        platform: 'mobile',
      },
    });
    expect(project.statusCode).toBe(201);
    const projectId = project.json().id as string;

    const dup = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: session.headers,
      payload: { key: 'SHOP', name: 'x', description: 'x', repoUrl: 'https://x.y/z', platform: 'web' },
    });
    expect(dup.statusCode).toBe(409);

    const badUrl = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: session.headers,
      payload: { key: 'BAD', name: 'x', description: 'x', repoUrl: 'ftp://x', platform: 'web' },
    });
    expect(badUrl.statusCode).toBe(400);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${projectId}`,
      headers: session.headers,
      payload: { dailyBudgetUsd: 20, maxChildrenPerTicket: 8 },
    });
    expect(patched.json()).toMatchObject({ dailyBudgetUsd: 20, maxChildrenPerTicket: 8, platform: 'mobile' });
    const list = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { cookie: session.cookie },
    });
    expect(list.json().items).toHaveLength(1);

    const ticket = await app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: session.headers,
      payload: {
        title: 'Thêm thanh toán',
        projectHintId: projectId,
        allowConfigChange: true,
        priority: 'high',
      },
    });
    expect(ticket.json()).toMatchObject({
      projectHintId: projectId,
      allowConfigChange: true,
      priority: 'high',
    });
    const key = ticket.json().key as string;

    const comment = await app.inject({
      method: 'POST',
      url: `/v1/tickets/${key}/comments`,
      headers: session.headers,
      payload: { body: 'Ưu tiên thẻ nội địa.' },
    });
    expect(comment.statusCode).toBe(201);
    expect(comment.json()).toMatchObject({ authorKind: 'owner', authorRole: null });

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${key}`,
      headers: { cookie: session.cookie },
    });
    expect(detail.json().comments).toHaveLength(1);
    expect(detail.json().events.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining(['ticket.assigned', 'ticket.comment_added']),
    );

    const report = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${key}/report`,
      headers: { cookie: session.cookie },
    });
    expect(report.json()).toEqual({ current: null, history: [] });

    const found = await app.inject({
      method: 'GET',
      url: '/v1/search?q=thanh',
      headers: { cookie: session.cookie },
    });
    expect(found.json().tickets.map((t: { key: string }) => t.key)).toEqual([key]);

    const filtered = await app.inject({
      method: 'GET',
      url: '/v1/tickets?type=request&priority=high,urgent&limit=5',
      headers: { cookie: session.cookie },
    });
    expect(filtered.json().items).toHaveLength(1);

    const missing = await app.inject({
      method: 'GET',
      url: '/v1/tickets/AST-99',
      headers: { cookie: session.cookie },
    });
    expect(missing.statusCode).toBe(404);

    const health = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(health.json()).toEqual({ status: 'ok', db: 'ok' });
  });
});
