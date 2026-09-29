import { describe, expect, it } from 'vitest';
import { addComment } from '../../api/src/services/ticket-service.js';
import { rolePlanner } from '../src/roles/role-planner.js';
import {
  commentsOf,
  devTicket,
  eventsOf,
  fixture,
  getTicket,
  ownerComment,
  pmTask,
  setStatus,
  useApi,
} from './helpers/api.js';
import { makeDaemon, waitFor } from './helpers/daemon.js';
import { makeRepo } from './helpers/git.js';

const api = useApi();

/** The daemon starts after every event so far: only what the test does next reaches it. */
async function startAfterSetup(t: ReturnType<typeof makeDaemon>): Promise<void> {
  const seqs = (await eventsOf(api.db)).map((e) => e.seq ?? 0n);
  const last = seqs.reduce((max, seq) => (seq > max ? seq : max), 0n);
  if (last > 0n) t.daemon.state.setCursor(String(last));
  await t.daemon.start();
}

const tool = (name: string, input: Record<string, unknown> = {}) => ({
  tool: `mcp__tickets__${name}`,
  input,
});

describe('owner @pm tag wakes the PM of the tree', () => {
  it("runs the PM with the owner's comment and the tagged ticket as context, and never the tagged ticket's agent", async () => {
    const f = await fixture(api);
    const t = makeDaemon(f, { repoPath: makeRepo(), extra: { planner: rolePlanner } });
    const pm = await pmTask(api, f, 'Thanh toán');
    const dev = await devTicket(api, pm.id, 'Nút thanh toán');
    await setStatus(api.db, dev.id, 'blocked');
    await addComment(api.db, {
      ticketId: dev.id,
      body: 'Ticket này chưa được PM đánh giá độ phức tạp (complexity).',
      authorKind: 'agent',
      authorRole: 'dev',
    });
    // The daemon's own record of the failed run of the tagged ticket.
    const failed = t.daemon.state.insertJob({
      ticketId: dev.id,
      projectId: f.projectId,
      role: 'dev',
      trigger: 'ticket.assigned',
    });
    t.daemon.state.updateJob(failed.id, { status: 'failed', error: 'MissingComplexity: chưa có complexity' });
    t.book.byTicket.set(pm.id, {
      steps: [tool('comment', { ticket: dev.key, body: 'PM đã xem và đánh giá lại.' })],
    });
    await startAfterSetup(t);

    await ownerComment(f, dev.id, '@pm đánh giá lại giúp ticket này rồi cho chạy lại');
    const run = await waitFor(
      () => t.book.runs.find((r) => r.ticketId === pm.id),
      15_000,
      'the PM run after the tag',
    );
    expect(run.stage).toBe('pm_monitor');
    expect(run.prompt).toContain('## Chủ dự án gọi PM (@pm)');
    expect(run.prompt).toContain(`### Gọi từ ${dev.key}`);
    expect(run.prompt).toContain('trạng thái `blocked`, complexity `small`');
    // The owner wrote the comment: verbatim, outside any untrusted block. The rest is wrapped.
    expect(run.prompt).toContain(
      'Bình luận của chủ dự án (do chủ dự án viết):\n\n@pm đánh giá lại giúp ticket này rồi cho chạy lại',
    );
    expect(run.prompt).toMatch(
      new RegExp(
        `<untrusted-data source="job error of ${dev.key}">\\nMissingComplexity: chưa có complexity\\n</untrusted-data>`,
      ),
    );
    expect(run.prompt).toContain(`<untrusted-data source="last agent comment on ${dev.key}">`);
    expect(run.prompt).toContain(`<untrusted-data source="ticket ${dev.key} title">`);

    await waitFor(
      async () => (await commentsOf(api.db, dev.id)).some((c) => c.body === 'PM đã xem và đánh giá lại.'),
      15_000,
      'the PM reply on the tagged ticket',
    );
    expect(t.book.runs.filter((r) => r.ticketId === dev.id)).toHaveLength(0);
    expect(t.daemon.state.jobsForTicket(dev.id)).toHaveLength(1);
    expect((await getTicket(api.db, dev.id)).status).toBe('blocked');
    await t.daemon.stop();
  });

  it('answers a tag while its own pm_task waits for the owner, in the monitor stage, without moving it', async () => {
    const f = await fixture(api);
    const t = makeDaemon(f, { repoPath: makeRepo(), extra: { planner: rolePlanner } });
    const pm = await pmTask(api, f, 'Giỏ hàng');
    const dev = await devTicket(api, pm.id, 'Thêm giỏ');
    await setStatus(api.db, pm.id, 'needs_input');
    await setStatus(api.db, dev.id, 'done');
    t.book.byTicket.set(pm.id, { steps: [tool('comment', { ticket: dev.key, body: 'Đã ghi nhận.' })] });
    await startAfterSetup(t);

    await ownerComment(f, dev.id, 'Nhờ @PM xem lại việc này');
    const run = await waitFor(
      () => t.book.runs.find((r) => r.ticketId === pm.id),
      15_000,
      'the PM run on a waiting pm_task',
    );
    expect(run.stage).toBe('pm_monitor');
    expect(run.prompt).toContain('PM task đang `needs_input` (chờ chủ dự án)');
    await waitFor(
      () => t.daemon.state.jobsForTicket(pm.id).some((j) => j.status === 'done'),
      15_000,
      'the PM job done',
    );
    expect((await getTicket(api.db, pm.id)).status).toBe('needs_input');
    await t.daemon.stop();
  });

  it('keeps skipping an untagged wake-up of a waiting pm_task', async () => {
    const f = await fixture(api);
    const t = makeDaemon(f, { repoPath: makeRepo(), extra: { planner: rolePlanner } });
    const pm = await pmTask(api, f, 'Kho');
    await devTicket(api, pm.id, 'Nhập kho');
    await setStatus(api.db, pm.id, 'in_review');
    await startAfterSetup(t);
    // An owner comment on a pm_task in review wakes its PM, which has nothing to do until the owner decides.
    await ownerComment(f, pm.id, 'Tôi sẽ xem sau');
    const job = await waitFor(
      () => t.daemon.state.jobsForTicket(pm.id).find((j) => j.status === 'skipped'),
      15_000,
      'the skipped PM job',
    );
    expect(job.trigger).toBe('ticket.comment_added');
    expect(t.book.runs.filter((r) => r.ticketId === pm.id)).toHaveLength(0);
    await t.daemon.stop();
  });

  it('runs the agent of a blocked ticket the owner comments on, as an unblock that carries the comment', async () => {
    const f = await fixture(api);
    const t = makeDaemon(f, { repoPath: makeRepo(), extra: { planner: rolePlanner } });
    const pm = await pmTask(api, f, 'Kho');
    await devTicket(api, pm.id, 'Nhập kho');
    await setStatus(api.db, pm.id, 'blocked');
    t.book.byTicket.set(pm.id, { steps: [tool('get_ticket')] });
    await startAfterSetup(t);
    await ownerComment(f, pm.id, 'Đã cấp quyền, làm tiếp đi');
    const run = await waitFor(
      () => t.book.runs.find((r) => r.ticketId === pm.id),
      15_000,
      'the PM run after the unblocking comment',
    );
    expect(run.prompt).toContain('chủ dự án mở chặn ticket (đọc bình luận mới nhất)');
    expect((await getTicket(api.db, pm.id)).status).not.toBe('blocked');
    const job = t.daemon.state.jobsForTicket(pm.id)[0];
    expect(job?.trigger).toBe('ticket.unblocked');
    expect(job?.eventIds).toHaveLength(2);
    await t.daemon.stop();
  });
});
