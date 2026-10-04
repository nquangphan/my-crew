import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import type { Comment, Decision, Ticket } from '../src/contracts/tickets.ts';
import { ApiFailure, assertOwnerPath, type OwnerClient } from '../src/lib/api.ts';
import { queryKeys } from '../src/lib/query-keys.ts';
import {
  actorLabel,
  buildLegacyTimeline,
  failureText,
  fetchAllPages,
  fetchTicketPage,
  formatTime,
  historyPageLimit,
  historyQueryOptions,
  parseTicketFilters,
  requestListFilters,
  ticketListOptions,
  ticketListPath,
  ticketQueryOptions,
} from '../src/tickets/queries.ts';
import {
  groupByStatus,
  isTerminal,
  mergeTicketPages,
  pickReturnFocus,
  requestRoots,
  statusIcons,
  statusLabels,
  statusOrder,
  waitNotice,
} from '../src/tickets/status.ts';

const projectId = '00000000-0000-4000-8000-0000000000aa';
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

function ticket(overrides: Partial<Ticket> & Pick<Ticket, 'id'>): Ticket {
  return {
    projectId,
    parentId: null,
    rootId: overrides.id,
    level: 'request',
    kind: 'code',
    title: 'Yêu cầu',
    description: 'Mô tả',
    mandatory: true,
    criteria: { workflowChoice: 'superpowers' },
    inputs: {},
    outputs: {},
    skill: null,
    workflowPin: null,
    status: 'pending',
    revision: 1,
    waitReason: null,
    repairCycles: 0,
    mergedCommit: null,
    ...overrides,
  };
}

type Fake = { client: OwnerClient; paths: string[] };
function fakeClient(answer: (path: string) => unknown): Fake {
  const paths: string[] = [];
  const client: OwnerClient = {
    async get<T>(path: string): Promise<T> {
      assertOwnerPath(path);
      paths.push(path);
      return answer(path) as T;
    },
    mutate: async () => {
      throw new Error('READ_ONLY');
    },
    upload: async () => {
      throw new Error('READ_ONLY');
    },
  };
  return { client, paths };
}

test('statusLabels đủ 7 nhãn tiếng Việt, mỗi trạng thái có biểu tượng riêng và thứ tự cột', () => {
  assert.deepEqual(statusLabels, {
    pending: 'Chờ thực hiện',
    ready: 'Sẵn sàng',
    running: 'Đang chạy',
    needs_input: 'Chờ bạn',
    paused: 'Tạm dừng',
    done: 'Hoàn thành',
    cancelled: 'Đã hủy',
  });
  assert.deepEqual(statusOrder, [
    'pending',
    'ready',
    'running',
    'needs_input',
    'paused',
    'done',
    'cancelled',
  ]);
  const icons = statusOrder.map((status) => statusIcons[status]);
  assert.equal(new Set(icons).size, 7, 'biểu tượng không trùng nhau');
  assert.ok(icons.every((icon) => typeof icon === 'string' && icon.length > 0));
  assert.equal(isTerminal('done'), true);
  assert.equal(isTerminal('cancelled'), true);
  assert.equal(isTerminal('needs_input'), false);
});

test('requestRoots chỉ nhận level request, id===rootId, parentId null; không suy từ title/trang đầu', () => {
  const rootA = ticket({ id: id(1), title: 'Trùng tên' });
  const rootB = ticket({ id: id(2), title: 'Trùng tên', status: 'done' });
  const cancelled = ticket({ id: id(3), status: 'cancelled' });
  const orphanStep = ticket({
    id: id(4),
    level: 'step',
    parentId: id(99),
    rootId: id(99),
    title: 'Trùng tên',
  });
  const mandatoryChild = ticket({
    id: id(5),
    level: 'step',
    parentId: id(1),
    rootId: id(1),
    mandatory: true,
  });
  const fakeRootLevel = ticket({ id: id(6), parentId: id(1), rootId: id(1) });
  const wrongRootId = ticket({ id: id(7), rootId: id(1) });
  const stepWithoutParent = ticket({ id: id(8), level: 'step', parentId: null });
  const roots = requestRoots([
    orphanStep,
    rootA,
    mandatoryChild,
    rootB,
    fakeRootLevel,
    wrongRootId,
    stepWithoutParent,
    cancelled,
  ]);
  assert.deepEqual(
    roots.map((root) => root.id),
    [id(1), id(2), id(3)],
  );
});

test('requestRoots và mergeTicketPages: ID trùng lấy revision mới bất kể thứ tự trang', () => {
  const older = ticket({ id: id(1), revision: 2, status: 'pending' });
  const newer = ticket({ id: id(1), revision: 5, status: 'running' });
  assert.equal(requestRoots([newer, older])[0]?.revision, 5);
  assert.equal(requestRoots([older, newer])[0]?.revision, 5);
  const merged = mergeTicketPages([[older, ticket({ id: id(2) })], [newer]]);
  assert.deepEqual(
    merged.map((row) => [row.id, row.revision]),
    [
      [id(1), 5],
      [id(2), 1],
    ],
  );
});

test('groupByStatus luôn có đủ 7 nhóm, gom done/cancelled riêng', () => {
  const groups = groupByStatus([
    ticket({ id: id(1), status: 'done' }),
    ticket({ id: id(2), status: 'cancelled' }),
    ticket({ id: id(3), status: 'needs_input' }),
    ticket({ id: id(4), status: 'done' }),
  ]);
  assert.deepEqual(Object.keys(groups), [...statusOrder]);
  assert.deepEqual(
    groups.done.map((row) => row.id),
    [id(1), id(4)],
  );
  assert.equal(groups.cancelled.length, 1);
  assert.equal(groups.needs_input.length, 1);
  assert.equal(groups.pending.length, 0);
});

test('parseTicketFilters chỉ giữ filter producer hỗ trợ với giá trị hợp lệ', () => {
  assert.deepEqual(
    parseTicketFilters({
      projectId,
      status: 'needs_input',
      kind: 'research',
      rootId: id(1),
      level: 'request',
      q: 'abc',
      cursor: id(2),
    }),
    { projectId, status: 'needs_input', kind: 'research', level: 'request', rootId: id(1) },
  );
  assert.deepEqual(
    parseTicketFilters({ projectId: 'không-phải-uuid', status: 'blocked', kind: 7, level: 'epic' }),
    {},
  );
  assert.deepEqual(parseTicketFilters(null), {});
});

test('ticketListPath dựng đúng query /v2/tickets với cursor UUID và limit', () => {
  const path = ticketListPath({ projectId, status: 'done' }, null);
  assert.equal(path, `/v2/tickets?projectId=${projectId}&status=done&limit=50`);
  assert.equal(assertOwnerPath(path), path);
  assert.equal(
    ticketListPath({ kind: 'docs', rootId: id(1) }, id(9)),
    `/v2/tickets?kind=docs&rootId=${id(1)}&cursor=${id(9)}&limit=50`,
  );
  assert.throws(() => ticketListPath({}, 'not-a-uuid'), /CURSOR_INVALID/);
});

test('fetchTicketPage giải mã DTO, sai shape báo RESPONSE_SHAPE_INVALID', async () => {
  const row = ticket({ id: id(1) });
  const ok = fakeClient(() => ({ items: [row], nextCursor: id(1) }));
  const page = await fetchTicketPage(ok.client, { projectId }, null);
  assert.deepEqual(page, { items: [row], nextCursor: id(1) });
  assert.deepEqual(ok.paths, [`/v2/tickets?projectId=${projectId}&limit=50`]);
  const bad = fakeClient(() => ({ items: [{ ...row, extra: true }], nextCursor: null }));
  await assert.rejects(
    fetchTicketPage(bad.client, {}, null),
    (error: unknown) => error instanceof ApiFailure && error.code === 'RESPONSE_SHAPE_INVALID',
  );
});

test('ticketListOptions phân trang tới nextCursor null, không tự tải hết', async () => {
  const options = ticketListOptions(fakeClient(() => null).client, { status: 'ready' });
  assert.deepEqual(options.queryKey, queryKeys.tickets({ status: 'ready' }));
  assert.equal(options.initialPageParam, null);
  assert.equal(options.retry, false);
  assert.equal(options.getNextPageParam({ items: [], nextCursor: id(3) }), id(3));
  assert.equal(options.getNextPageParam({ items: [], nextCursor: null }), undefined);
});

function comment(n: number, createdAt: string, text = `bình luận ${n}`): Comment {
  return { id: id(n), ticketId: id(1), actor: { kind: 'owner', id: 'owner' }, text, createdAt };
}
function decision(n: number, createdAt: string): Decision {
  return {
    id: id(n),
    ticketId: id(1),
    actor: { kind: 'machine', id: id(77) },
    kind: 'assessment',
    content: `quyết định ${n}`,
    rationale: `lý do ${n}`,
    sources: [{ kind: 'docs', id: id(55), path: 'docs/a.md' }],
    scope: {},
    createdAt,
  };
}

test('fetchAllPages đọc hết trang theo cursor đến null', async () => {
  const pages: Record<string, unknown> = {
    '': { items: [comment(3, '2026-10-01T00:00:00.000Z')], nextCursor: id(3) },
    [id(3)]: { items: [comment(9, '2026-10-01T00:00:01.000Z')], nextCursor: id(9) },
    [id(9)]: { items: [], nextCursor: null },
  };
  const fake = fakeClient((path) => pages[new URL(path, 'http://x').searchParams.get('cursor') ?? '']);
  const items = await fetchAllPages(fake.client, `/v2/tickets/${id(1)}/comments`, 'comment');
  assert.deepEqual(
    items.map((item) => item.id),
    [id(3), id(9)],
  );
  assert.deepEqual(fake.paths, [
    `/v2/tickets/${id(1)}/comments?limit=${historyPageLimit}`,
    `/v2/tickets/${id(1)}/comments?cursor=${id(3)}&limit=${historyPageLimit}`,
    `/v2/tickets/${id(1)}/comments?cursor=${id(9)}&limit=${historyPageLimit}`,
  ]);
});

test('fetchAllPages dừng khi cursor lặp lại thay vì vòng vô hạn', async () => {
  const fake = fakeClient(() => ({ items: [comment(3, '2026-10-01T00:00:00.000Z')], nextCursor: id(3) }));
  await assert.rejects(
    fetchAllPages(fake.client, `/v2/tickets/${id(1)}/comments`, 'comment'),
    (error: unknown) => error instanceof ApiFailure && error.code === 'PAGE_CURSOR_LOOP',
  );
  assert.equal(fake.paths.length, 2);
});

test('buildLegacyTimeline sắp theo createdAt rồi id, không theo thứ tự UUID', () => {
  // UUID order is the reverse of chronology here.
  const timeline = buildLegacyTimeline(
    [comment(9, '2026-10-01T01:00:00.000Z'), comment(8, '2026-10-01T03:00:00.000Z')],
    [decision(2, '2026-10-01T02:00:00.000Z'), decision(1, '2026-10-01T03:00:00.000Z')],
  );
  assert.deepEqual(
    timeline.map((entry) => [entry.source, entry.id]),
    [
      ['comment', id(9)],
      ['decision', id(2)],
      ['decision', id(1)],
      ['comment', id(8)],
    ],
  );
  const recorded = timeline[1];
  assert.equal(recorded?.source, 'decision');
  if (recorded?.source === 'decision') {
    assert.equal(recorded.kind, 'assessment');
    assert.equal(recorded.rationale, 'lý do 2');
    assert.deepEqual(recorded.sources, [{ kind: 'docs', id: id(55), path: 'docs/a.md' }]);
    assert.deepEqual(recorded.actor, { kind: 'machine', id: id(77) });
  }
});

test('ticketQueryOptions: response revision cũ không ghi đè revision mới trong cache', async () => {
  const cache = new QueryClient();
  const newer = ticket({ id: id(1), revision: 7, status: 'running' });
  const older = ticket({ id: id(1), revision: 3, status: 'pending' });
  cache.setQueryData(queryKeys.ticket(id(1)), newer);
  const options = ticketQueryOptions(fakeClient(() => older).client, cache, id(1));
  assert.deepEqual(options.queryKey, queryKeys.ticket(id(1)));
  const signal = new AbortController().signal;
  assert.equal((await options.queryFn({ signal })).revision, 7);
  const fresher = ticket({ id: id(1), revision: 8, status: 'done' });
  const next = ticketQueryOptions(fakeClient(() => fresher).client, cache, id(1));
  assert.equal((await next.queryFn({ signal })).status, 'done');
});

test('ticketQueryOptions từ chối ticketId không phải UUID trước khi gọi mạng', async () => {
  const fake = fakeClient(() => null);
  const options = ticketQueryOptions(fake.client, new QueryClient(), '../v1');
  await assert.rejects(
    options.queryFn({ signal: new AbortController().signal }),
    (error: unknown) => error instanceof ApiFailure && error.code === 'TICKET_ID_INVALID',
  );
  assert.equal(fake.paths.length, 0);
});

test('formatTime hiển thị theo Asia/Ho_Chi_Minh, chuỗi lỗi giữ nguyên', () => {
  assert.equal(formatTime('2026-10-04T00:30:00.000Z'), '07:30 04/10/2026');
  assert.equal(formatTime('không phải thời gian'), 'không phải thời gian');
});

test('actorLabel phân biệt chủ dự án và máy', () => {
  assert.equal(actorLabel({ kind: 'owner', id: 'owner' }), 'Chủ dự án');
  assert.equal(actorLabel({ kind: 'machine', id: id(77) }), `Máy ${id(77).slice(0, 8)}`);
});

test('pickReturnFocus: trả về trigger nếu còn trong DOM, nếu mất thì container dự phòng', () => {
  const node = (connected: boolean) => ({ isConnected: connected, focus: () => undefined });
  const trigger = node(true);
  const lostTrigger = node(false);
  const container = node(true);
  const main = node(true);
  assert.equal(pickReturnFocus([trigger, container, main]), trigger);
  assert.equal(pickReturnFocus([lostTrigger, container, main]), container);
  assert.equal(pickReturnFocus([lostTrigger, null, main]), main);
  assert.equal(pickReturnFocus([lostTrigger, null]), null);
});

test('ticketListPath gửi filter level của producer cho danh sách yêu cầu gốc', () => {
  assert.equal(
    ticketListPath({ projectId, level: 'request' }, null),
    `/v2/tickets?projectId=${projectId}&level=request&limit=50`,
  );
});

test('ticketId chữ hoa được chuẩn hóa chữ thường cho query key, path và revision guard', async () => {
  const lower = id(0xabc);
  const upper = lower.toUpperCase();
  const cache = new QueryClient();
  cache.setQueryData(queryKeys.ticket(lower), ticket({ id: lower, revision: 9, status: 'running' }));
  const fake = fakeClient(() => ticket({ id: lower, revision: 2, status: 'pending' }));
  const options = ticketQueryOptions(fake.client, cache, upper);
  assert.deepEqual(options.queryKey, queryKeys.ticket(lower));
  const signal = new AbortController().signal;
  assert.equal((await options.queryFn({ signal })).revision, 9, 'response cũ không ghi đè cache chữ thường');
  assert.deepEqual(fake.paths, [`/v2/tickets/${lower}`]);
  const comments = historyQueryOptions(fake.client, upper, 'comment');
  const decisions = historyQueryOptions(fake.client, upper, 'decision');
  assert.deepEqual(comments.queryKey, queryKeys.comments(lower));
  assert.deepEqual(decisions.queryKey, queryKeys.decisions(lower));
});

test('historyQueryOptions đọc đúng collection bằng ID chữ thường', async () => {
  const lower = id(0xdef);
  const fake = fakeClient(() => ({ items: [], nextCursor: null }));
  const signal = new AbortController().signal;
  await historyQueryOptions(fake.client, lower.toUpperCase(), 'decision').queryFn({ signal });
  assert.deepEqual(fake.paths, [`/v2/tickets/${lower}/decisions?limit=${historyPageLimit}`]);
});

test('failureText tách lỗi phía trình duyệt, hủy tải và lỗi máy chủ', () => {
  assert.equal(
    failureText(new ApiFailure(null, 'TICKET_ID_INVALID', 'local')),
    'Đường dẫn ticket không hợp lệ.',
  );
  assert.doesNotMatch(failureText(new ApiFailure(null, 'CURSOR_INVALID', 'local')), /Máy chủ/);
  assert.doesNotMatch(failureText(new ApiFailure(null, 'ABORTED', 'aborted')), /Máy chủ/);
  assert.match(failureText(new ApiFailure(null, 'ABORTED', 'aborted')), /hủy/);
  assert.equal(failureText(new ApiFailure(500, 'INTERNAL', 'http')), 'Máy chủ báo lỗi (INTERNAL).');
  assert.equal(
    failureText(new ApiFailure(404, 'NOT_FOUND', 'http')),
    'Không tìm thấy ticket hoặc bạn không có quyền xem.',
  );
  assert.equal(failureText(new ApiFailure(null, 'X', 'transport')), 'Mất kết nối tới máy chủ.');
});

test('waitNotice hiện waitReason ở mọi trạng thái, chỉ nói “chờ bạn” khi needs_input', () => {
  const running = waitNotice('running', 'final_result_pending');
  assert.ok(running, 'final_result_pending khi đang chạy vẫn hiện');
  assert.match(running, /^Lý do chờ: /);
  assert.doesNotMatch(running, /chờ bạn/i);
  const needs = waitNotice('needs_input', 'repair_limit');
  assert.match(needs ?? '', /Đã sửa đủ 5 vòng/);
  assert.match(needs ?? '', /^Đang chờ bạn/);
  const odd = waitNotice('needs_input', 'final_result_pending');
  assert.doesNotMatch(odd ?? '', /Đang chờ bạn: Đang chờ/, 'không tự mâu thuẫn');
  assert.match(waitNotice('needs_input', null) ?? '', /chưa ghi lý do/);
  assert.match(waitNotice('paused', 'ma_la') ?? '', /ma_la/);
  assert.equal(waitNotice('ready', null), null);
});

test('requestListFilters ép level request cho view yêu cầu, giữ filter producer khác', () => {
  assert.deepEqual(requestListFilters({ projectId, status: 'done', level: 'step' }), {
    projectId,
    status: 'done',
    level: 'request',
  });
  assert.deepEqual(requestListFilters({}), { level: 'request' });
});
