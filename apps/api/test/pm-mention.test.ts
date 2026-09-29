import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addComment, createSubtask, fileBug, retrySubtask } from '../src/services/ticket-service.js';
import { pairTestMachine, writeHeaders } from './helpers/machines.js';
import { type LoggedInOwner, makeApp, seedAndLogin } from './helpers/owner-session.js';
import {
  commentsOf,
  createDevWithQc,
  createTestProject,
  createTree,
  eventsOf,
  getTicket,
  RATED,
  setStatus,
  useTestDb,
} from './helpers/test-db.js';

const ctx = useTestDb();

/** A pm_task tree with one subtask of every type: dev, its QC, a bug filed by the QC, and docs-init. */
async function fullTree() {
  const tree = await createTree(ctx.db);
  const { dev, qc } = await createDevWithQc(ctx.db, tree.pmTask.id);
  await setStatus(ctx.db, qc.id, 'in_progress');
  const { bug } = await fileBug(ctx.db, qc.id, { title: 'Nút thanh toán không phản hồi' });
  const docsInit = await createSubtask(ctx.db, {
    type: 'docs_init',
    parentId: tree.pmTask.id,
    title: 'Khởi tạo docs',
  });
  return { ...tree, dev, qc, bug, docsInit };
}

async function wakeEvents() {
  return [
    ...(await eventsOf(ctx.db, 'ticket.pm_mentioned')),
    ...(await eventsOf(ctx.db, 'ticket.comment_added')),
  ];
}

describe('owner @pm tag', () => {
  it('wakes the PM of the tree from every ticket type, targeted at the project machine with role pm', async () => {
    const tree = await fullTree();
    const sources = [tree.pmTask, tree.dev, tree.qc, tree.bug, tree.docsInit];
    for (const source of sources) {
      const comment = await addComment(ctx.db, {
        ticketId: source.id,
        body: `@pm xem giúp ${source.key}`,
        authorKind: 'owner',
      });
      const last = (await eventsOf(ctx.db, 'ticket.pm_mentioned')).at(-1);
      expect(last, source.type).toMatchObject({
        ticketId: tree.pmTask.id,
        projectId: tree.project.id,
        targetMachineId: tree.projectMachine,
        targetRole: 'pm',
      });
      expect(last?.payload).toEqual({
        type: 'ticket.pm_mentioned',
        data: {
          ticketId: tree.pmTask.id,
          sourceTicketId: source.id,
          sourceTicketKey: source.key,
          commentId: comment.id,
        },
      });
    }
    expect(await eventsOf(ctx.db, 'ticket.pm_mentioned')).toHaveLength(sources.length);
    // The tag replaces the tagged ticket's own wake-up.
    expect(await eventsOf(ctx.db, 'ticket.comment_added')).toHaveLength(0);
  });

  it("wakes only the PM: the tagged ticket's agent is not woken and its needs_input status stays", async () => {
    const tree = await fullTree();
    await setStatus(ctx.db, tree.dev.id, 'needs_input');
    await addComment(ctx.db, { ticketId: tree.dev.id, body: 'Nhờ @PM quyết giúp.', authorKind: 'owner' });
    expect((await getTicket(ctx.db, tree.dev.id)).status).toBe('needs_input');
    const woken = await wakeEvents();
    expect(woken.map((e) => [e.type, e.ticketId, e.targetRole])).toEqual([
      ['ticket.pm_mentioned', tree.pmTask.id, 'pm'],
    ]);
  });

  it('leaves a blocked tagged ticket blocked: the PM decides whether to retry it', async () => {
    const tree = await fullTree();
    await setStatus(ctx.db, tree.dev.id, 'blocked');
    await addComment(ctx.db, { ticketId: tree.dev.id, body: '@pm xem vì sao bị chặn', authorKind: 'owner' });
    expect((await getTicket(ctx.db, tree.dev.id)).status).toBe('blocked');
    expect(await eventsOf(ctx.db, 'ticket.unblocked')).toHaveLength(0);
    expect((await wakeEvents()).map((e) => e.type)).toEqual(['ticket.pm_mentioned']);
  });

  it('on the pm_task itself also answers its needs_input, like any owner answer there', async () => {
    const tree = await createTree(ctx.db);
    await setStatus(ctx.db, tree.pmTask.id, 'needs_input');
    await addComment(ctx.db, { ticketId: tree.pmTask.id, body: '@pm dùng Stripe.', authorKind: 'owner' });
    expect((await getTicket(ctx.db, tree.pmTask.id)).status).toBe('in_progress');
    const types = (await eventsOf(ctx.db))
      .filter((e) => e.ticketId === tree.pmTask.id)
      .map((e) => e.type)
      .slice(-2);
    expect(types).toEqual(['ticket.status_changed', 'ticket.pm_mentioned']);
    expect(await eventsOf(ctx.db, 'ticket.comment_added')).toHaveLength(0);
  });

  it('wakes the PM from a closed subtask of an open tree', async () => {
    const tree = await fullTree();
    await setStatus(ctx.db, tree.dev.id, 'done');
    await addComment(ctx.db, { ticketId: tree.dev.id, body: '@pm việc này chưa đúng', authorKind: 'owner' });
    expect(await eventsOf(ctx.db, 'ticket.pm_mentioned')).toHaveLength(1);
  });

  it('ignores a tag inside code or inside a word, and keeps the ticket agent wake-up', async () => {
    const tree = await fullTree();
    for (const body of ['viết `@pm` để gọi PM', '```\n@pm\n```', 'mail team@pm.example.com']) {
      await addComment(ctx.db, { ticketId: tree.dev.id, body, authorKind: 'owner' });
    }
    expect(await eventsOf(ctx.db, 'ticket.pm_mentioned')).toHaveLength(0);
    const added = await eventsOf(ctx.db, 'ticket.comment_added');
    expect(added).toHaveLength(3);
    expect(added.every((e) => e.ticketId === tree.dev.id && e.targetRole === 'dev')).toBe(true);
  });

  it('never counts a tag in an agent comment', async () => {
    const tree = await fullTree();
    await addComment(ctx.db, {
      ticketId: tree.dev.id,
      body: '@pm giúp tôi',
      authorKind: 'agent',
      authorRole: 'dev',
    });
    expect(await wakeEvents()).toHaveLength(0);
  });
});

describe('owner @pm tag over HTTP', () => {
  let app: FastifyInstance;
  let owner: LoggedInOwner;
  beforeEach(async () => {
    app = await makeApp(ctx.db);
    owner = await seedAndLogin(app, ctx.db);
  });
  afterEach(() => app.close());

  const post = (ticketId: string, body: string) =>
    app.inject({
      method: 'POST',
      url: `/v1/tickets/${ticketId}/comments`,
      headers: owner.headers,
      payload: { body },
    });

  it('returns the comment with mentions, and the ticket detail lists them for owner comments only', async () => {
    const tree = await fullTree();
    const tagged = await post(tree.dev.id, '@pm đánh giá lại giúp');
    expect(tagged.statusCode).toBe(201);
    expect(tagged.json()).toMatchObject({ authorKind: 'owner', mentions: ['pm'] });
    const plain = await post(tree.dev.id, 'Không gọi ai');
    expect(plain.json().mentions).toEqual([]);
    await addComment(ctx.db, { ticketId: tree.dev.id, body: '@pm', authorKind: 'agent', authorRole: 'dev' });

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tree.dev.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(detail.json().comments.map((c: { mentions: string[] }) => c.mentions)).toEqual([['pm'], [], []]);
  });

  it('refuses a tag on a ticket outside any pm_task tree with 400 PM_NOT_AVAILABLE and stores nothing', async () => {
    const tree = await createTree(ctx.db);
    const res = await post(tree.request.id, '@pm xem giúp');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'PM_NOT_AVAILABLE',
      message: expect.stringContaining('belongs to no pm_task'),
    });
    expect(await commentsOf(ctx.db, tree.request.id)).toHaveLength(0);
    expect(await wakeEvents()).toHaveLength(0);
    // Without the tag the same comment goes through as before.
    expect((await post(tree.request.id, 'xem giúp')).statusCode).toBe(201);
  });

  it('refuses a tag when the tree is closed', async () => {
    const tree = await fullTree();
    await setStatus(ctx.db, tree.pmTask.id, 'done');
    const res = await post(tree.dev.id, '@pm còn lỗi');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'PM_NOT_AVAILABLE',
      message: expect.stringContaining(`${tree.pmTask.key} is done`),
    });
    expect(await commentsOf(ctx.db, tree.dev.id)).toHaveLength(0);
  });
});

describe('PM retries a blocked subtask', () => {
  it('moves it back to in_progress and wakes its agent', async () => {
    const tree = await fullTree();
    await setStatus(ctx.db, tree.dev.id, 'blocked');
    const ticket = await retrySubtask(ctx.db, tree.pmTask.id, { ticket: tree.dev.key });
    expect(ticket.status).toBe('in_progress');
    const [unblocked] = await eventsOf(ctx.db, 'ticket.unblocked');
    expect(unblocked).toMatchObject({
      ticketId: tree.dev.id,
      targetMachineId: tree.projectMachine,
      targetRole: 'dev',
    });
  });

  it('refuses a subtask that is not blocked, one of another tree, and a caller that is not a pm_task', async () => {
    const tree = await fullTree();
    await expect(retrySubtask(ctx.db, tree.pmTask.id, { ticket: tree.dev.key })).rejects.toMatchObject({
      code: 'ILLEGAL_TRANSITION',
    });
    const project = await createTestProject(ctx.db, {
      ownerMachineId: tree.projectMachine,
      key: 'APP',
      name: 'Ứng dụng',
      repoUrl: 'https://github.com/2p/app.git',
    });
    const otherPm = await createSubtask(ctx.db, {
      type: 'pm_task',
      parentId: tree.request.id,
      projectId: project.id,
      title: 'Khác',
    });
    await setStatus(ctx.db, tree.dev.id, 'blocked');
    await expect(retrySubtask(ctx.db, otherPm.id, { ticket: tree.dev.key })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(retrySubtask(ctx.db, tree.dev.id, { ticket: tree.dev.key })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect((await getTicket(ctx.db, tree.dev.id)).status).toBe('blocked');
  });

  it('is reachable by the machine that owns the project, idempotently', async () => {
    const app = await makeApp(ctx.db);
    try {
      const machine = await pairTestMachine(ctx.db, 'mac-a');
      const project = await createTestProject(ctx.db, { ownerMachineId: machine.machineId });
      const tree = await createTree(ctx.db, {
        key: 'SHOP',
        name: 'Shop',
        repoUrl: 'https://x.test/shop.git',
      });
      const pmTask = await createSubtask(ctx.db, {
        type: 'pm_task',
        parentId: tree.request.id,
        projectId: project.id,
        title: 'Việc',
      });
      const dev = await createSubtask(ctx.db, { type: 'dev', ...RATED, parentId: pmTask.id, title: 'Dev' });
      await setStatus(ctx.db, dev.id, 'blocked');
      const headers = writeHeaders(machine);
      const call = () =>
        app.inject({
          method: 'POST',
          url: `/v1/daemon/tickets/${pmTask.id}/retry-subtask`,
          headers,
          payload: { ticket: dev.key },
        });
      const first = await call();
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ key: dev.key, status: 'in_progress' });
      expect((await call()).json()).toEqual(first.json());
      expect(await eventsOf(ctx.db, 'ticket.unblocked')).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});
