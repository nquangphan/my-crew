import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type BugFindingResultBody,
  createBridgeFileReader,
  createRelayMemory,
  MAX_ATTEMPTS,
  OUTBOX_MAX,
  REPORT_CUT_NOTE,
  REPORT_MAX_BYTES,
  RESULT_READ_GRACE_MS,
  RETRY_BASE_MS,
  type RelayState,
  type ResultsDeps,
  relayResponses,
  relayView,
} from '../src/main/bug-finding/results';
import {
  PaperclipAuthError,
  PaperclipForbiddenError,
  PaperclipHttpError,
} from '../src/main/paperclip/client';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const MACHINE = '22222222-2222-4222-8222-222222222222';
const HEAD = 'b'.repeat(40);
const reqId = (n: number) => `7a0c3f2e-1b4d-4c5e-8f60-${String(n).padStart(12, '0')}`;
const R1 = reqId(1);
const ORIGIN = 'https://crew.example';

/** Kết quả `review-result.json` của skill bug-finding (đủ trường mà relay đọc, thêm trường thừa để kiểm rút gọn). */
const sampleResult = {
  schema: 'review-result/1',
  baseline: {},
  coverage: {},
  findings: [
    {
      id: 'F-01',
      rule: 'MF-07',
      title: 'Token cũ dùng lại sau khi đăng xuất',
      certainty: 'Confirmed',
      severity: 'HIGH',
      status: 'OPEN',
      action: 'CODE_FIX',
      mr_relation: 'introduced',
      location: { file: 'src/auth.ts', line: 42, symbol: 'logout' },
      fix: 'Xóa token trong logout()',
      accept: 'Test đăng xuất rồi gọi API trả 401',
      evidence: [{ kind: 'SOURCE', ref: 'src/auth.ts:42' }],
      impact: 'phiên cũ còn dùng được',
      sources: ['claude-lane'],
    },
    {
      id: 'F-02',
      rule: 'UNCATEGORIZED',
      certainty: 'Needs-Clarification',
      severity: 'LOW',
      fix: 'Hỏi lại hợp đồng',
      question: 'Có cần giữ trường cũ?',
    },
  ],
};

const response = (requestId: string, state: string, over: Record<string, unknown> = {}) => ({
  schema: 'crew-review-response/1',
  requestId,
  state,
  headSha: HEAD,
  ...over,
});
const succeededResponse = (requestId: string, resultDir: string, over: Record<string, unknown> = {}) =>
  response(requestId, 'succeeded', {
    round: 1,
    lanesDone: 4,
    lanesTotal: 4,
    verdict: 'BLOCK',
    costUsd: 1.25,
    tokens: 12345,
    resultDir,
    reportPath: `${resultDir}/mr-87-r1.md`,
    ...over,
  });

type Post = (body: BugFindingResultBody) => Promise<void>;

/** Deps giả của relay: thư mục responses, file trên đĩa, `app.json` và Paperclip đều nằm trong bộ nhớ. */
function fakeResultsDeps(opts: {
  responses: unknown[];
  files?: Record<string, string>;
  post: Post;
  state?: Partial<RelayState>;
  known?: string[];
}) {
  let clock = Date.parse('2026-11-04T05:00:00.000Z');
  const known = opts.known ?? [R1];
  const state: RelayState = {
    outbox: [],
    requests: Object.fromEntries(
      known.map((id) => [
        id,
        { companyId: COMPANY, machineId: MACHINE, origin: ORIGIN, at: '2026-11-04T04:00:00.000Z' },
      ]),
    ),
    ...opts.state,
  };
  const deps: ResultsDeps & {
    responses: unknown[];
    state: RelayState;
    origin: string | null;
    postedTo: string[];
    send: Post;
    tick(ms: number): void;
  } = {
    responses: opts.responses,
    state,
    origin: ORIGIN,
    postedTo: [],
    send: opts.post,
    listResponses: async () => deps.responses,
    readFile: async (path) => {
      const body = opts.files?.[path];
      if (body === undefined) throw new Error(`ENOENT: ${path}`);
      return body;
    },
    load: () => structuredClone(deps.state),
    save: async (next) => {
      deps.state = structuredClone(next);
    },
    currentOrigin: () => deps.origin,
    post: async (origin, body) => {
      deps.postedTo.push(origin);
      await deps.send(body);
    },
    now: () => clock,
    memory: createRelayMemory(),
    log: () => undefined,
    tick: (ms) => {
      clock += ms;
    },
  };
  return deps;
}

const FINDING_KEYS = [
  'accept',
  'action',
  'certainty',
  'fix',
  'id',
  'location',
  'mr_relation',
  'question',
  'rule',
  'severity',
  'status',
  'title',
];

describe('relayResponses', () => {
  it('rút gọn finding và giữ hàng đợi khi gửi lỗi', async () => {
    const sent: BugFindingResultBody[] = [];
    const deps = fakeResultsDeps({
      responses: [succeededResponse(R1, '/res')],
      files: { '/res/review-result.json': JSON.stringify(sampleResult), '/res/mr-87-r1.md': '# Báo cáo' },
      post: async (b) => {
        sent.push(b);
        throw new Error('ECONNRESET');
      },
    });
    expect(await relayResponses(deps)).toEqual({ sent: 0, pending: 1 });
    expect(deps.state.outbox).toHaveLength(1);
    deps.send = async (b) => {
      sent.push(b);
    };
    expect(await relayResponses(deps)).toEqual({ sent: 1, pending: 0 });
    const body = sent[1] as BugFindingResultBody;
    expect(Object.keys(body.findings?.[0] ?? {}).sort()).toEqual(FINDING_KEYS);
    expect(body).toMatchObject({
      companyId: COMPANY,
      machineId: MACHINE,
      requestId: R1,
      state: 'succeeded',
      round: 1,
      headSha: HEAD,
      lanesDone: 4,
      lanesTotal: 4,
      verdict: 'BLOCK',
      costUsd: 1.25,
      reportMarkdown: '# Báo cáo',
    });
    expect(body.findings?.[0]).toEqual({
      id: 'F-01',
      rule: 'MF-07',
      title: 'Token cũ dùng lại sau khi đăng xuất',
      severity: 'HIGH',
      certainty: 'Confirmed',
      status: 'OPEN',
      action: 'CODE_FIX',
      mr_relation: 'introduced',
      location: 'src/auth.ts:42 (logout)',
      fix: 'Xóa token trong logout()',
      accept: 'Test đăng xuất rồi gọi API trả 401',
      question: null,
    });
    // Finding thiếu title/status (schema skill cho phép): server bắt buộc hai trường này nên điền mặc định.
    expect(body.findings?.[1]).toMatchObject({
      id: 'F-02',
      title: 'UNCATEGORIZED',
      status: 'OPEN',
      location: null,
      question: 'Có cần giữ trường cũ?',
    });
    // Đã gửi xong kết quả cuối: lượt sau không gửi lại.
    expect(await relayResponses(deps)).toEqual({ sent: 0, pending: 0 });
    expect(sent).toHaveLength(2);
    // Kết quả không có decision_items thì không gửi khóa decisionItems (server cũ không nhận khóa lạ).
    expect(body).not.toHaveProperty('decisionItems');
  });

  it('gửi kèm decision_items thành decisionItems, bỏ mục thiếu câu hỏi hay không gom finding nào', async () => {
    const sent: BugFindingResultBody[] = [];
    const withDecisions = {
      ...sampleResult,
      decision_items: [
        {
          id: 'Q-01',
          question: 'Rút gọn hay vẽ đủ cột?',
          owner: 'owner',
          kind: 'PRODUCT',
          findings: ['F-01', 'F-02'],
        },
        { id: 'Q-02', question: 'Không gom finding nào', findings: [] },
        { id: 'Q-03', findings: ['F-01'] },
      ],
    };
    const deps = fakeResultsDeps({
      responses: [succeededResponse(R1, '/res')],
      files: { '/res/review-result.json': JSON.stringify(withDecisions), '/res/mr-87-r1.md': '# Báo cáo' },
      post: async (b) => {
        sent.push(b);
      },
    });
    expect(await relayResponses(deps)).toEqual({ sent: 1, pending: 0 });
    expect(sent[0]?.decisionItems).toEqual([
      { id: 'Q-01', question: 'Rút gọn hay vẽ đủ cột?', findings: ['F-01', 'F-02'] },
    ]);
  });

  it('hàng đợi gửi không giữ báo cáo trong app.json, đọc lại file lúc gửi lại', async () => {
    const deps = fakeResultsDeps({
      responses: [succeededResponse(R1, '/res')],
      files: { '/res/review-result.json': JSON.stringify(sampleResult), '/res/mr-87-r1.md': '# Báo cáo' },
      post: async () => {
        throw new PaperclipHttpError(0, 'network', 'Không kết nối được Paperclip');
      },
    });
    await relayResponses(deps);
    expect(JSON.stringify(deps.state.outbox)).not.toContain('# Báo cáo');
    expect(deps.state.outbox[0]?.reportPath).toBe('/res/mr-87-r1.md');
  });

  it('báo cáo > 2 MB bị cắt và thêm dòng ghi chú, tổng không quá 2 MB', async () => {
    const sent: BugFindingResultBody[] = [];
    const big = `# Báo cáo\n${'đ'.repeat(1_500_000)}`; // ~3 MB UTF-8
    const deps = fakeResultsDeps({
      responses: [succeededResponse(R1, '/res')],
      files: { '/res/review-result.json': JSON.stringify(sampleResult), '/res/mr-87-r1.md': big },
      post: async (b) => {
        sent.push(b);
      },
    });
    await relayResponses(deps);
    const report = sent[0]?.reportMarkdown ?? '';
    expect(Buffer.byteLength(report)).toBeLessThanOrEqual(REPORT_MAX_BYTES);
    expect(report.startsWith('# Báo cáo\nđđ')).toBe(true);
    expect(report.trimEnd().endsWith(REPORT_CUT_NOTE)).toBe(true);
    expect(REPORT_CUT_NOTE).toBe('(báo cáo bị cắt, xem đầy đủ trong Bug Finding)');
    expect(report).not.toContain('�');
  });

  it('báo cáo nhỏ gửi nguyên văn', async () => {
    const sent: BugFindingResultBody[] = [];
    const deps = fakeResultsDeps({
      responses: [succeededResponse(R1, '/res')],
      files: { '/res/review-result.json': JSON.stringify(sampleResult), '/res/mr-87-r1.md': 'ngắn' },
      post: async (b) => {
        sent.push(b);
      },
    });
    await relayResponses(deps);
    expect(sent[0]?.reportMarkdown).toBe('ngắn');
  });

  it('running gửi tối đa 1 lần/phút mỗi requestId', async () => {
    const sent: BugFindingResultBody[] = [];
    const deps = fakeResultsDeps({
      responses: [response(R1, 'running', { lanesDone: 1, lanesTotal: 4 })],
      post: async (b) => {
        sent.push(b);
      },
    });
    expect(await relayResponses(deps)).toEqual({ sent: 1, pending: 0 });
    deps.responses = [response(R1, 'running', { lanesDone: 2, lanesTotal: 4 })];
    deps.tick(30_000);
    expect(await relayResponses(deps)).toEqual({ sent: 0, pending: 0 });
    deps.tick(30_000);
    expect(await relayResponses(deps)).toEqual({ sent: 1, pending: 0 });
    expect(sent.map((b) => [b.state, b.lanesDone])).toEqual([
      ['running', 1],
      ['running', 2],
    ]);
    // Không đổi gì thì không gửi lại dù đã quá 1 phút.
    deps.tick(120_000);
    expect(await relayResponses(deps)).toEqual({ sent: 0, pending: 0 });
    // Đổi trạng thái (xong) thì gửi ngay, không chờ đủ phút.
    deps.responses = [response(R1, 'failed', { error: 'head_mismatch' })];
    deps.tick(1_000);
    expect(await relayResponses(deps)).toEqual({ sent: 1, pending: 0 });
    expect(sent[2]).toMatchObject({ state: 'failed', error: 'head_mismatch' });
  });

  it('queued gửi một lần', async () => {
    const sent: BugFindingResultBody[] = [];
    const deps = fakeResultsDeps({
      responses: [response(R1, 'queued')],
      post: async (b) => {
        sent.push(b);
      },
    });
    await relayResponses(deps);
    deps.tick(120_000);
    await relayResponses(deps);
    expect(sent.map((b) => b.state)).toEqual(['queued']);
  });

  it('succeeded mà mãi không đọc được review-result.json → hết thời gian chờ thì gửi failed kèm lý do', async () => {
    const sent: BugFindingResultBody[] = [];
    const deps = fakeResultsDeps({
      responses: [succeededResponse(R1, '/mat')],
      post: async (b) => {
        sent.push(b);
      },
    });
    await relayResponses(deps);
    expect(sent).toEqual([]);
    deps.tick(RESULT_READ_GRACE_MS);
    await relayResponses(deps);
    expect(sent[0]).toMatchObject({ state: 'failed', requestId: R1 });
    expect(sent[0]?.error).toContain('review-result.json');
    expect(sent[0]?.findings).toBeUndefined();
  });

  it('server từ chối hẳn (409, 422, 404) thì bỏ, không gửi lại mãi', async () => {
    let posts = 0;
    const deps = fakeResultsDeps({
      responses: [response(R1, 'failed', { error: 'x' })],
      post: async () => {
        posts += 1;
        throw new PaperclipHttpError(409, null);
      },
    });
    expect(await relayResponses(deps)).toEqual({ sent: 0, pending: 0 });
    deps.tick(60_000);
    expect(await relayResponses(deps)).toEqual({ sent: 0, pending: 0 });
    expect(posts).toBe(1);
  });

  it('server lỗi 5xx thì giữ để gửi lại', async () => {
    const deps = fakeResultsDeps({
      responses: [response(R1, 'failed', { error: 'x' })],
      post: async () => {
        throw new PaperclipHttpError(502, null);
      },
    });
    expect(await relayResponses(deps)).toEqual({ sent: 0, pending: 1 });
  });

  it('response của request không do 2P Crew xếp (không có trong sổ) thì bỏ qua', async () => {
    let posts = 0;
    const deps = fakeResultsDeps({
      responses: [response(reqId(9), 'running'), { schema: 'khac', requestId: 'r-1' }],
      post: async () => {
        posts += 1;
      },
    });
    expect(await relayResponses(deps)).toEqual({ sent: 0, pending: 0 });
    expect(posts).toBe(0);
  });

  it('hàng đợi tối đa 200 mục, bỏ mục cũ nhất', async () => {
    const ids = Array.from({ length: OUTBOX_MAX }, (_, i) => reqId(100 + i));
    const outbox = ids.map((id, i) => ({
      requestId: id,
      body: {
        companyId: COMPANY,
        machineId: MACHINE,
        requestId: id,
        state: 'running' as const,
        headSha: HEAD,
      },
      origin: ORIGIN,
      queuedAt: new Date(Date.parse('2026-11-04T04:00:00.000Z') + i * 1000).toISOString(),
    }));
    const deps = fakeResultsDeps({
      responses: [response(R1, 'queued')],
      known: [R1, ...ids],
      state: { outbox },
      post: async () => {
        throw new Error('ECONNRESET');
      },
    });
    expect(await relayResponses(deps)).toEqual({ sent: 0, pending: OUTBOX_MAX });
    const kept = deps.state.outbox.map((item) => item.requestId);
    expect(kept).not.toContain(ids[0]);
    expect(kept).toContain(R1);
    expect(OUTBOX_MAX).toBe(200);
  });

  it('trạng thái mới của cùng requestId thay mục cũ trong hàng đợi', async () => {
    const deps = fakeResultsDeps({
      responses: [response(R1, 'running', { lanesDone: 1 })],
      post: async () => {
        throw new Error('ECONNRESET');
      },
    });
    await relayResponses(deps);
    deps.responses = [response(R1, 'failed', { error: 'hủy' })];
    expect(await relayResponses(deps)).toEqual({ sent: 0, pending: 1 });
    expect(deps.state.outbox[0]?.body.state).toBe('failed');
  });

  it('review-result.json đang ghi dở lần đầu: không gửi failed, lượt sau đọc được thì gửi succeeded', async () => {
    const sent: BugFindingResultBody[] = [];
    const files: Record<string, string> = { '/res/review-result.json': '{"findings": [' };
    const deps = fakeResultsDeps({
      responses: [succeededResponse(R1, '/res', { reportPath: undefined })],
      files,
      post: async (b) => {
        sent.push(b);
      },
    });
    expect(await relayResponses(deps)).toEqual({ sent: 0, pending: 0 });
    files['/res/review-result.json'] = JSON.stringify(sampleResult);
    deps.tick(30_000);
    expect(await relayResponses(deps)).toEqual({ sent: 1, pending: 0 });
    expect(sent.map((b) => b.state)).toEqual(['succeeded']);
    expect(sent[0]?.findings).toHaveLength(2);
  });

  it('413 với báo cáo: gửi lại ngay bản không có báo cáo (giữ finding), không bỏ kết quả', async () => {
    const sent: BugFindingResultBody[] = [];
    const deps = fakeResultsDeps({
      responses: [succeededResponse(R1, '/res')],
      files: { '/res/review-result.json': JSON.stringify(sampleResult), '/res/mr-87-r1.md': '# Báo cáo dài' },
      post: async (b) => {
        sent.push(b);
        if (b.reportMarkdown !== undefined) throw new PaperclipHttpError(413, null);
      },
    });
    expect(await relayResponses(deps)).toEqual({ sent: 1, pending: 0 });
    expect(sent).toHaveLength(2);
    expect(sent[1]?.reportMarkdown).toBeUndefined();
    expect(sent[1]?.findings).toHaveLength(2);
    expect(deps.state.requests[R1]?.delivered).toBe(true);
  });

  it.each([408, 413, 429, 500, 503])(
    'HTTP %i là lỗi tạm thời: giữ mục, không đánh dấu đã gửi',
    async (status) => {
      const deps = fakeResultsDeps({
        responses: [response(R1, 'failed', { error: 'x' })],
        post: async () => {
          throw new PaperclipHttpError(status, null);
        },
      });
      expect(await relayResponses(deps)).toEqual({ sent: 0, pending: 1 });
      expect(deps.state.requests[R1]?.delivered).toBeUndefined();
      expect(deps.state.outbox[0]?.attempts).toBe(1);
    },
  );

  it('một mục luôn lỗi 500 không chặn mục khác; lùi thời gian riêng; quá số lần thì bỏ kèm cảnh báo', async () => {
    const R2 = reqId(2);
    const sent: string[] = [];
    let postsR1 = 0;
    const logs: string[] = [];
    const deps = fakeResultsDeps({
      known: [R1, R2],
      responses: [response(R1, 'failed', { error: 'x' }), response(R2, 'failed', { error: 'y' })],
      post: async (b) => {
        if (b.requestId === R1) {
          postsR1 += 1;
          throw new PaperclipHttpError(500, null);
        }
        sent.push(b.requestId);
      },
    });
    deps.log = (_level, event) => logs.push(event);
    expect(await relayResponses(deps)).toEqual({ sent: 1, pending: 1 });
    expect(sent).toEqual([R2]);
    // Chưa tới giờ thử lại thì không gửi.
    deps.tick(RETRY_BASE_MS - 1);
    await relayResponses(deps);
    expect(postsR1).toBe(1);
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
      deps.tick(60 * 60_000);
      await relayResponses(deps);
    }
    expect(postsR1).toBe(MAX_ATTEMPTS);
    expect(deps.state.outbox).toEqual([]);
    expect(deps.state.requests[R1]?.delivered).toBe(true);
    expect(deps.state.requests[R1]?.gaveUp).toContain('500');
    expect(logs).toContain('bug-finding-relay-gave-up');
    expect(relayView(deps.state.outbox, deps.state.requests, ORIGIN).gaveUp).toHaveLength(1);
  });

  it('kết quả của lượt nhận ở origin A không gửi sang origin đang đăng nhập B; về A thì gửi tới A', async () => {
    const deps = fakeResultsDeps({
      responses: [response(R1, 'failed', { error: 'x' })],
      post: async () => undefined,
    });
    deps.origin = 'https://other.example';
    expect(await relayResponses(deps)).toEqual({ sent: 0, pending: 1 });
    expect(deps.postedTo).toEqual([]);
    expect(deps.state.requests[R1]?.delivered).toBeUndefined();
    expect(relayView(deps.state.outbox, deps.state.requests, deps.origin).held).toEqual([
      { origin: ORIGIN, count: 1 },
    ]);
    deps.origin = null;
    expect(await relayResponses(deps)).toEqual({ sent: 0, pending: 1 });
    deps.origin = ORIGIN;
    expect(await relayResponses(deps)).toEqual({ sent: 1, pending: 0 });
    expect(deps.postedTo).toEqual([ORIGIN]);
  });

  it('403 (tài khoản không thuộc company) và 401: giữ mục, không đánh dấu đã gửi, không đếm lần thử', async () => {
    for (const error of [new PaperclipForbiddenError(), new PaperclipAuthError()]) {
      const deps = fakeResultsDeps({
        responses: [response(R1, 'failed', { error: 'x' })],
        post: async () => {
          throw error;
        },
      });
      expect(await relayResponses(deps)).toEqual({ sent: 0, pending: 1 });
      expect(deps.state.requests[R1]?.delivered).toBeUndefined();
      expect(deps.state.outbox[0]?.attempts).toBeUndefined();
    }
  });

  it('lưu app.json lỗi khi vừa xếp bản tin: lượt sau vẫn xếp lại và gửi', async () => {
    const sent: BugFindingResultBody[] = [];
    let saves = 0;
    const deps = fakeResultsDeps({
      responses: [response(R1, 'failed', { error: 'x' })],
      post: async () => {
        throw new Error('ECONNRESET');
      },
    });
    const realSave = deps.save;
    deps.save = async (next) => {
      saves += 1;
      if (saves === 1) throw new Error('ENOSPC');
      await realSave(next);
    };
    await relayResponses(deps);
    expect(deps.state.outbox).toEqual([]);
    deps.send = async (b) => {
      sent.push(b);
    };
    expect(await relayResponses(deps)).toEqual({ sent: 1, pending: 0 });
    expect(sent[0]).toMatchObject({ state: 'failed', requestId: R1 });
  });

  it('reportPath không phải .md (vd /etc/hosts) thì không đọc, không gửi kèm', async () => {
    const sent: BugFindingResultBody[] = [];
    const deps = fakeResultsDeps({
      responses: [succeededResponse(R1, '/res', { reportPath: '/etc/hosts' })],
      files: { '/res/review-result.json': JSON.stringify(sampleResult), '/etc/hosts': '127.0.0.1 localhost' },
      post: async (b) => {
        sent.push(b);
      },
    });
    await relayResponses(deps);
    expect(sent[0]?.state).toBe('succeeded');
    expect(sent[0]?.reportMarkdown).toBeUndefined();
  });
});

describe('createBridgeFileReader', () => {
  it('chỉ đọc file trong thư mục dữ liệu Bug Finding, kể cả qua symlink', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bf-reader-'));
    try {
      const root = join(dir, 'MRReviewQueue');
      mkdirSync(join(root, 'reviews'), { recursive: true });
      writeFileSync(join(root, 'reviews', 'r.md'), '# trong');
      writeFileSync(join(dir, 'secret.md'), 'bí mật');
      symlinkSync(join(dir, 'secret.md'), join(root, 'reviews', 'link.md'));
      const read = createBridgeFileReader(root);
      expect(await read(join(root, 'reviews', 'r.md'))).toBe('# trong');
      await expect(read(join(dir, 'secret.md'))).rejects.toThrow('ngoài thư mục dữ liệu');
      await expect(read(join(root, 'reviews', 'link.md'))).rejects.toThrow('ngoài thư mục dữ liệu');
      await expect(read(join(root, '..', 'secret.md'))).rejects.toThrow('ngoài thư mục dữ liệu');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
