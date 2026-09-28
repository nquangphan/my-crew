import { DOCS_SNAPSHOT_MAX_BYTES, type DocsSyncRequest } from '@crew/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { docsFiles, projects } from '../src/db/schema.js';
import { type PairedMachine, pairTestMachine, writeHeaders } from './helpers/machines.js';
import { type LoggedInOwner, makeApp, seedAndLogin } from './helpers/owner-session.js';
import { createTestProject, eventsOf, useTestDb } from './helpers/test-db.js';

const ctx = useTestDb();
let app: FastifyInstance;
let owner: LoggedInOwner;
let mac: PairedMachine;
let other: PairedMachine;
let projectId: string;

const SHA1 = '1'.repeat(40);
const SHA2 = '2'.repeat(40);

const MANIFEST = `version: 1
source:
  include: ["src/**"]
flows:
  ticket-assignment:
    title: Giao ticket
    doc: docs/flows/ticket-assignment.md
    files: [src/assign.ts]
  checkout:
    title: Đặt hàng
    doc: docs/flows/checkout.md
    files: [src/checkout.ts]
`;

function snapshot(overrides: Partial<DocsSyncRequest> = {}): DocsSyncRequest {
  return {
    commit: SHA1,
    branch: 'main',
    files: [
      { path: 'docs/flows.yaml', content: MANIFEST },
      { path: 'docs/index.md', content: '# Shop API\n\nMục đích của dự án.' },
      { path: 'docs/architecture.md', content: '# Kiến trúc\n\nPostgres và Fastify.' },
      { path: 'docs/files.md', content: '# Tra cứu file\n' },
      { path: 'docs/flows/ticket-assignment.md', content: '# Giao ticket\n\n## Mục đích\n\nGiao 100%_việc.' },
      { path: 'docs/flows/checkout.md', content: '# Đặt hàng\n\n## Mục đích\n\nThanh toán giỏ hàng.' },
      { path: 'docs/guides/deploy.md', content: '# Triển khai\n\nChạy docker compose.' },
      { path: 'AGENTS.md', content: '# AGENTS\n\nĐọc docs/index.md trước.' },
    ],
    ...overrides,
  };
}

function sync(machine: PairedMachine, body: unknown, key?: string, projectKey = 'WEB') {
  return app.inject({
    method: 'PUT',
    url: `/v1/daemon/projects/${projectKey}/docs`,
    headers: writeHeaders(machine, key),
    payload: body as object,
  });
}

function ownerGet(url: string) {
  return app.inject({ method: 'GET', url, headers: { cookie: owner.cookie } });
}

beforeEach(async () => {
  app = await makeApp(ctx.db);
  owner = await seedAndLogin(app, ctx.db);
  mac = await pairTestMachine(ctx.db, 'mac-a');
  other = await pairTestMachine(ctx.db, 'mac-b');
  projectId = (await createTestProject(ctx.db, { ownerMachineId: mac.machineId })).id;
});
afterEach(() => app.close());

describe('PUT /v1/daemon/projects/:key/docs', () => {
  it('stores the snapshot, marks docs ready and tells the owner stream only', async () => {
    const res = await sync(mac, snapshot());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ projectId, commit: SHA1, branch: 'main', fileCount: 8 });

    const [project] = await ctx.db.select().from(projects).where(eq(projects.id, projectId));
    expect(project?.docsStatus).toBe('ready');
    const [event] = await eventsOf(ctx.db, 'docs.synced');
    expect(event).toMatchObject({ projectId, targetMachineId: null });
    expect(event?.payload).toEqual({ type: 'docs.synced', data: { projectId, commitSha: SHA1 } });

    const space = await ownerGet(`/v1/projects/${projectId}/docs`);
    expect(space.statusCode).toBe(200);
    const body = space.json();
    expect(body.snapshot).toMatchObject({ commit: SHA1, branch: 'main' });
    expect(Object.keys(body.manifest.flows).sort()).toEqual(['checkout', 'ticket-assignment']);
    const byPath = Object.fromEntries(
      (body.pages as { path: string; kind: string; title: string; flowId: string | null }[]).map((p) => [
        p.path,
        p,
      ]),
    );
    expect(byPath['docs/index.md']).toMatchObject({ kind: 'index', title: 'Tổng quan' });
    expect(byPath['docs/architecture.md']).toMatchObject({ kind: 'architecture', title: 'Kiến trúc' });
    expect(byPath['docs/files.md']).toMatchObject({ kind: 'files', title: 'Tra cứu file' });
    expect(byPath['AGENTS.md']).toMatchObject({ kind: 'agents' });
    expect(byPath['docs/flows/checkout.md']).toMatchObject({
      kind: 'flow',
      title: 'Đặt hàng',
      flowId: 'checkout',
    });
    expect(byPath['docs/guides/deploy.md']).toMatchObject({ kind: 'other', title: 'Triển khai' });
  });

  it('replaces the previous snapshot instead of merging it', async () => {
    expect((await sync(mac, snapshot())).statusCode).toBe(200);
    const files = snapshot().files.filter((file) => file.path !== 'docs/guides/deploy.md');
    expect((await sync(mac, snapshot({ commit: SHA2, files }))).statusCode).toBe(200);
    const rows = await ctx.db.select().from(docsFiles).where(eq(docsFiles.projectId, projectId));
    expect(rows.map((row) => row.path)).not.toContain('docs/guides/deploy.md');
    expect(rows).toHaveLength(7);
    const space = (await ownerGet(`/v1/projects/${projectId}/docs`)).json();
    expect(space.snapshot.commit).toBe(SHA2);
  });

  it('refuses machines that do not own the project and unknown projects', async () => {
    expect((await sync(other, snapshot())).statusCode).toBe(403);
    expect((await sync(mac, snapshot(), undefined, 'NOPE')).statusCode).toBe(404);
    expect(await eventsOf(ctx.db, 'docs.synced')).toHaveLength(0);
  });

  it('requires a machine token and an Idempotency-Key, and replays a retry', async () => {
    const noAuth = await app.inject({
      method: 'PUT',
      url: '/v1/daemon/projects/WEB/docs',
      payload: snapshot(),
    });
    expect(noAuth.statusCode).toBe(401);
    const noKey = await app.inject({
      method: 'PUT',
      url: '/v1/daemon/projects/WEB/docs',
      headers: mac.auth,
      payload: snapshot(),
    });
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const first = await sync(mac, snapshot(), 'docs-sync-key-1');
    const retry = await sync(mac, snapshot(), 'docs-sync-key-1');
    expect(retry.json()).toEqual(first.json());
    expect(await eventsOf(ctx.db, 'docs.synced')).toHaveLength(1);
  });

  it('validates the SHA, paths, manifest and size', async () => {
    const cases: unknown[] = [
      snapshot({ commit: 'abc1234' }),
      snapshot({ commit: 'ab'.repeat(20).toUpperCase() }),
      snapshot({ files: [...snapshot().files, { path: 'docs/../src/secret.md', content: 'x' }] }),
      snapshot({ files: [...snapshot().files, { path: 'src/app.ts', content: 'x' }] }),
      snapshot({ files: [...snapshot().files, { path: '/docs/abs.md', content: 'x' }] }),
      snapshot({ files: snapshot().files.filter((file) => file.path !== 'docs/flows.yaml') }),
      snapshot({ files: [{ path: 'docs/flows.yaml', content: 'version: 2\n' }] }),
      snapshot({ files: [{ path: 'docs/flows.yaml', content: 'version: 1\nversion: 1\n' }] }),
      snapshot({ files: [{ path: 'docs/flows.yaml', content: 'flows: [' }] }),
    ];
    for (const body of cases) {
      const res = await sync(mac, body);
      expect(res.statusCode, JSON.stringify(body).slice(0, 120)).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    }
    const huge = snapshot({
      files: [...snapshot().files, { path: 'docs/huge.md', content: 'x'.repeat(DOCS_SNAPSHOT_MAX_BYTES) }],
    });
    expect([400, 413]).toContain((await sync(mac, huge)).statusCode);
    expect(await eventsOf(ctx.db, 'docs.synced')).toHaveLength(0);
  });
});

describe('owner docs reads', () => {
  beforeEach(async () => {
    expect((await sync(mac, snapshot())).statusCode).toBe(200);
  });

  it('returns an empty space before the first sync and 404 for unknown projects', async () => {
    const fresh = await createTestProject(ctx.db, { key: 'NEW', ownerMachineId: mac.machineId });
    expect((await ownerGet(`/v1/projects/${fresh.id}/docs`)).json()).toEqual({
      snapshot: null,
      pages: [],
      manifest: null,
    });
    expect((await ownerGet(`/v1/projects/${fresh.id}/docs/page?path=docs/index.md`)).statusCode).toBe(404);
    expect((await ownerGet('/v1/projects/00000000-0000-4000-8000-000000000000/docs')).statusCode).toBe(404);
  });

  it('serves one page by normalized path and refuses paths outside the allow-list', async () => {
    const page = await ownerGet(`/v1/projects/${projectId}/docs/page?path=docs//flows/./checkout.md`);
    expect(page.statusCode).toBe(200);
    expect(page.json().page).toMatchObject({ path: 'docs/flows/checkout.md', flowId: 'checkout' });
    expect(page.json().page.content).toContain('Thanh toán giỏ hàng');
    expect(page.json().snapshot.commit).toBe(SHA1);
    expect((await ownerGet(`/v1/projects/${projectId}/docs/page?path=docs/nope.md`)).statusCode).toBe(404);
    expect(
      (await ownerGet(`/v1/projects/${projectId}/docs/page?path=${encodeURIComponent('docs/../x.md')}`))
        .statusCode,
    ).toBe(400);
  });

  it('searches one space with LIKE wildcards escaped, with snippets', async () => {
    const res = await ownerGet(`/v1/projects/${projectId}/docs/search?q=docker`);
    expect(res.json().items).toEqual([
      expect.objectContaining({ path: 'docs/guides/deploy.md', snippet: expect.stringContaining('docker') }),
    ]);
    const literal = await ownerGet(`/v1/projects/${projectId}/docs/search?q=${encodeURIComponent('100%_')}`);
    expect(literal.json().items.map((item: { path: string }) => item.path)).toEqual([
      'docs/flows/ticket-assignment.md',
    ]);
    const wildcard = await ownerGet(`/v1/projects/${projectId}/docs/search?q=${encodeURIComponent('%')}`);
    expect(wildcard.json().items.map((item: { path: string }) => item.path)).toEqual([
      'docs/flows/ticket-assignment.md',
    ]);
    const titleFirst = await ownerGet(`/v1/projects/${projectId}/docs/search?q=${encodeURIComponent('Đặt')}`);
    expect(titleFirst.json().items[0].path).toBe('docs/flows/checkout.md');
  });

  it('adds docs pages to the global quick search', async () => {
    const res = await ownerGet(`/v1/search?q=${encodeURIComponent('Kiến trúc')}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().docs).toContainEqual({ projectId, path: 'docs/architecture.md', title: 'Kiến trúc' });
  });

  it('is owner-only: no session and a machine token both get 401', async () => {
    expect((await app.inject({ method: 'GET', url: `/v1/projects/${projectId}/docs` })).statusCode).toBe(401);
    const withToken = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectId}/docs`,
      headers: mac.auth,
    });
    expect(withToken.statusCode).toBe(401);
  });
});
