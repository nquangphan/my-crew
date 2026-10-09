import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLoginFlow } from '../src/main/paperclip/cli-auth.js';
import { type FakeHandler, startFakePaperclip } from './paperclip-fake-server.js';

const ID = '99999999-9999-4999-8999-999999999999';
const TOKEN = 'thu-thach-bi-mat-0123456789';
const BOARD = 'pcp_board_khoa-moi-0123456789abcdef';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

function challenge(origin: string, approvalUrl: string | null | 'other' = 'same') {
  const approvalPath = `/cli-auth/${ID}?token=${TOKEN}`;
  return {
    id: ID,
    token: TOKEN,
    boardApiToken: BOARD,
    approvalPath,
    approvalUrl:
      approvalUrl === 'same'
        ? `${origin}${approvalPath}`
        : approvalUrl === 'other'
          ? `http://lan:3100${approvalPath}`
          : null,
    pollPath: `/cli-auth/challenges/${ID}`,
    expiresAt: '2026-10-09T06:00:00.000Z',
    suggestedPollIntervalMs: 1000,
  };
}

async function setup(statuses: string[], approvalUrl: string | null | 'other' = 'same') {
  let origin = '';
  const queue = [...statuses];
  const handler: FakeHandler = (req) => {
    if (req.method === 'POST') return { status: 201, body: challenge(origin, approvalUrl) };
    const status = queue.shift() ?? 'pending';
    if (status === '404') return { status: 404, body: { error: 'CLI auth challenge not found' } };
    return { status: 200, body: { id: ID, status } };
  };
  const server = await startFakePaperclip(handler);
  origin = server.origin;
  close = server.close;
  const saveKey = vi.fn(async () => undefined);
  const onApproved = vi.fn();
  const log = vi.fn();
  const flow = createLoginFlow({ fetch: globalThis.fetch, saveKey, onApproved, hostname: 'mac-mini', log });
  return { server, flow, saveKey, onApproved, log };
}

describe('startLogin', () => {
  it('POST /api/cli-auth/challenges đúng body, trả approvalUrl', async () => {
    const { server, flow } = await setup([]);
    const { approvalUrl } = await flow.start(server.origin);
    expect(approvalUrl).toBe(`${server.origin}/cli-auth/${ID}?token=${TOKEN}`);
    expect(server.requests[0]).toMatchObject({
      method: 'POST',
      path: '/api/cli-auth/challenges',
      authorization: null,
      body: { command: '2P Crew app', clientName: '2P Crew trên mac-mini', requestedAccess: 'board' },
    });
  });

  it('approvalUrl null (hoặc khác origin) thì dựng từ origin + approvalPath', async () => {
    const a = await setup([], null);
    await expect(a.flow.start(a.server.origin)).resolves.toEqual({
      approvalUrl: `${a.server.origin}/cli-auth/${ID}?token=${TOKEN}`,
    });
    await close?.();
    const b = await setup([], 'other');
    await expect(b.flow.start(b.server.origin)).resolves.toEqual({
      approvalUrl: `${b.server.origin}/cli-auth/${ID}?token=${TOKEN}`,
    });
  });

  it('companyId đi vào requestedCompanyId', async () => {
    const { server, flow } = await setup([]);
    await flow.start(server.origin, '11111111-1111-4111-8111-111111111111');
    expect(server.requests[0]?.body).toMatchObject({
      requestedCompanyId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('origin http lạ bị từ chối trước khi gọi mạng', async () => {
    const { flow } = await setup([]);
    await expect(flow.start('http://example.com')).rejects.toThrow('Paperclip phải dùng https');
  });
});

describe('pollLogin', () => {
  it('pending → pending; approved → lưu key đúng một lần, xóa khỏi bộ nhớ', async () => {
    const { server, flow, saveKey, onApproved } = await setup(['pending', 'approved']);
    await flow.start(server.origin);
    await expect(flow.poll()).resolves.toBe('pending');
    await expect(flow.poll()).resolves.toBe('approved');
    await expect(flow.poll()).resolves.toBe('approved');
    expect(saveKey).toHaveBeenCalledTimes(1);
    expect(saveKey).toHaveBeenCalledWith(server.origin, BOARD);
    expect(onApproved).toHaveBeenCalledWith(server.origin);
    const polls = server.requests.filter((r) => r.method === 'GET');
    expect(polls).toHaveLength(2);
    expect(polls[0]).toMatchObject({ path: `/api/cli-auth/challenges/${ID}`, query: { token: TOKEN } });
  });

  it('hai lần poll song song cùng thấy approved vẫn chỉ lưu một lần', async () => {
    const { server, flow, saveKey } = await setup(['approved', 'approved']);
    await flow.start(server.origin);
    await Promise.all([flow.poll(), flow.poll()]);
    expect(saveKey).toHaveBeenCalledTimes(1);
  });

  it('expired / cancelled / 404 → trạng thái tương ứng, không lưu key', async () => {
    for (const [status, expected] of [
      ['expired', 'expired'],
      ['cancelled', 'cancelled'],
      ['404', 'expired'],
    ] as const) {
      const { server, flow, saveKey } = await setup([status]);
      await flow.start(server.origin);
      await expect(flow.poll()).resolves.toBe(expected);
      await expect(flow.poll()).resolves.toBe(expected);
      expect(saveKey).not.toHaveBeenCalled();
      await close?.();
      close = null;
    }
  });

  it('chưa bắt đầu đăng nhập thì poll trả expired', async () => {
    const { flow } = await setup([]);
    await expect(flow.poll()).resolves.toBe('expired');
  });

  it('log không chứa token thử thách hay board key', async () => {
    const { server, flow, log } = await setup(['pending', 'approved']);
    await flow.start(server.origin);
    await flow.poll();
    await flow.poll();
    for (const call of log.mock.calls) {
      const text = JSON.stringify(call);
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(BOARD);
    }
  });
});
