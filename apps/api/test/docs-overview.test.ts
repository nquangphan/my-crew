import type { DocsSyncRequest } from '@crew/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequestTicket, createSubtask } from '../src/services/ticket-service.js';
import { type PairedMachine, pairTestMachine, writeHeaders } from './helpers/machines.js';
import { type LoggedInOwner, makeApp, seedAndLogin } from './helpers/owner-session.js';
import { createTestProject, setStatus, useTestDb } from './helpers/test-db.js';

const ctx = useTestDb();
let app: FastifyInstance;
let owner: LoggedInOwner;
let mac: PairedMachine;
let shop: { id: string };
let admin: { id: string };
let note: { id: string };

const SHA1 = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
const MANIFEST = `version: 1
source:
  include: ["src/**"]
flows:
  checkout:
    title: Đặt hàng
    doc: docs/flows/checkout.md
    files: [src/checkout.ts]
`;

function snapshot(commit: string, title: string): DocsSyncRequest {
  return {
    commit,
    branch: 'main',
    files: [
      { path: 'docs/flows.yaml', content: MANIFEST },
      { path: 'docs/index.md', content: `# ${title}\n\nTổng quan về thanh toán.` },
      { path: 'docs/flows/checkout.md', content: '# Đặt hàng\n\nThanh toán giỏ hàng.' },
    ],
  };
}

async function sync(projectKey: string, body: DocsSyncRequest) {
  const res = await app.inject({
    method: 'PUT',
    url: `/v1/daemon/projects/${projectKey}/docs`,
    headers: writeHeaders(mac),
    payload: body,
  });
  expect(res.statusCode).toBe(200);
}

function ownerGet(url: string) {
  return app.inject({ method: 'GET', url, headers: { cookie: owner.cookie } });
}

beforeEach(async () => {
  app = await makeApp(ctx.db);
  owner = await seedAndLogin(app, ctx.db);
  mac = await pairTestMachine(ctx.db, 'mac-a');
  shop = await createTestProject(ctx.db, { key: 'SHOP', ownerMachineId: mac.machineId });
  admin = await createTestProject(ctx.db, {
    key: 'ADMIN',
    name: 'Admin',
    repoUrl: 'https://github.com/2p/admin.git',
    ownerMachineId: mac.machineId,
  });
  note = await createTestProject(ctx.db, {
    key: 'NOTE',
    name: 'Note',
    repoUrl: 'https://github.com/2p/note.git',
    ownerMachineId: mac.machineId,
  });
  await sync('SHOP', snapshot(SHA1, 'Shop'));
  await sync('ADMIN', snapshot(SHA2, 'Admin'));
});
afterEach(() => app.close());

/** A request routed to NOTE with a pm_task and its docs_init child, left blocked. */
async function blockedDocsInit() {
  const request = await createRequestTicket(ctx.db, { title: 'Khởi tạo docs cho Note' });
  const pmTask = await createSubtask(ctx.db, {
    type: 'pm_task',
    parentId: request.id,
    projectId: note.id,
    title: 'PM Note',
  });
  const docsInit = await createSubtask(ctx.db, {
    type: 'docs_init',
    parentId: pmTask.id,
    title: 'Khởi tạo docs',
  });
  await setStatus(ctx.db, docsInit.id, 'blocked');
  return docsInit;
}

describe('GET /v1/docs', () => {
  it('lists every project with its docs status, snapshot, file count and docs-init ticket', async () => {
    const docsInit = await blockedDocsInit();
    const res = await ownerGet('/v1/docs');
    expect(res.statusCode).toBe(200);
    const items = res.json().items as {
      projectId: string;
      docsStatus: string;
      snapshot: { commit: string } | null;
      fileCount: number;
      docsInit: { key: string; status: string } | null;
    }[];
    // Project key order: ADMIN, NOTE, SHOP.
    expect(items.map((item) => item.projectId)).toEqual([admin.id, note.id, shop.id]);
    expect(items[0]).toMatchObject({
      docsStatus: 'ready',
      snapshot: { commit: SHA2, branch: 'main' },
      fileCount: 3,
      docsInit: null,
    });
    expect(items[1]).toMatchObject({
      docsStatus: 'unknown',
      snapshot: null,
      fileCount: 0,
      docsInit: { key: docsInit.key, status: 'blocked', title: 'Khởi tạo docs' },
    });
    expect(items[2]).toMatchObject({ docsStatus: 'ready', snapshot: { commit: SHA1 }, fileCount: 3 });
  });

  it('is owner-only', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/docs' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /v1/docs/search', () => {
  it('searches every project and tags each page with its project', async () => {
    const res = await ownerGet(`/v1/docs/search?q=${encodeURIComponent('thanh toán')}`);
    expect(res.statusCode).toBe(200);
    const items = res.json().items as { projectId: string; path: string; snippet: string }[];
    expect(new Set(items.map((item) => item.projectId))).toEqual(new Set([shop.id, admin.id]));
    expect(items).toHaveLength(4);
    expect(items.find((item) => item.projectId === shop.id && item.path === 'docs/index.md')).toMatchObject({
      kind: 'index',
      title: 'Tổng quan',
    });
    expect(items[0]?.snippet.toLowerCase()).toContain('thanh toán');
  });

  it('narrows to projectIds', async () => {
    const res = await ownerGet(`/v1/docs/search?q=${encodeURIComponent('giỏ hàng')}&projectIds=${admin.id}`);
    expect(res.statusCode).toBe(200);
    const items = res.json().items as { projectId: string; path: string }[];
    expect(items).toEqual([expect.objectContaining({ projectId: admin.id, path: 'docs/flows/checkout.md' })]);
  });

  it('refuses a malformed project id or an empty query, and anonymous callers', async () => {
    expect((await ownerGet('/v1/docs/search?q=x&projectIds=nope')).statusCode).toBe(400);
    expect((await ownerGet('/v1/docs/search?q=')).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/v1/docs/search?q=x' })).statusCode).toBe(401);
  });
});

describe('GET /v1/search with projectIds', () => {
  it('returns each ticket project and narrows tickets and docs to the chosen projects', async () => {
    const docsInit = await blockedDocsInit();
    const all = await ownerGet(`/v1/search?q=${encodeURIComponent('docs')}`);
    expect(all.statusCode).toBe(200);
    const tickets = all.json().tickets as { key: string; projectId: string | null; type: string }[];
    expect(tickets.find((t) => t.key === docsInit.key)?.projectId).toBe(note.id);
    expect(tickets.find((t) => t.type === 'request')?.projectId).toBeNull();

    const onlyShop = await ownerGet(`/v1/search?q=${encodeURIComponent('docs')}&projectIds=${shop.id}`);
    expect(onlyShop.json().tickets).toEqual([]);

    const onlyNote = await ownerGet(`/v1/search?q=${encodeURIComponent('docs')}&projectIds=${note.id}`);
    // The docs_init ticket and the request routed to NOTE (through its pm_task).
    expect((onlyNote.json().tickets as { key: string }[]).map((t) => t.key).sort()).toEqual(
      [docsInit.key, tickets.find((t) => t.type === 'request')?.key].sort(),
    );

    const docs = await ownerGet(`/v1/search?q=${encodeURIComponent('thanh toán')}&projectIds=${shop.id}`);
    const pages = docs.json().docs as { projectId: string }[];
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.every((page) => page.projectId === shop.id)).toBe(true);
  });
});
