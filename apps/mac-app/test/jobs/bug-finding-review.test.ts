import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LaunchResult } from '../../src/main/bug-finding/launch.js';
import { type BugFindingReviewDeps, runBugFindingReview, runJob } from '../../src/main/jobs/executors.js';
import type { MachineJob } from '../../src/main/jobs/types.js';
import { machineGuardReason, validateJobPayload } from '../../src/main/jobs/validate.js';

const REQUEST = '7a0c3f2e-1b4d-4c5e-8f60-0123456789ab';
const COMPANY = '11111111-1111-4111-8111-111111111111';
const MACHINE = '22222222-2222-4222-8222-222222222222';
const HEAD = 'a'.repeat(40);

const payload = (over: Record<string, unknown> = {}) => ({
  requestId: REQUEST,
  issueId: '33333333-3333-4333-8333-333333333333',
  identifier: 'TPS-645',
  run: 1,
  projectId: '44444444-4444-4444-8444-444444444444',
  projectKey: 'my-crew',
  repoPath: '/Volumes/CORSAIR/Projects/my-crew',
  provider: 'github',
  prNumber: 87,
  prUrl: 'https://github.com/nquangphan/my-crew/pull/87',
  headSha: HEAD,
  baseBranch: 'main',
  ...over,
});

describe('validateJobPayload: bug-finding-review', () => {
  it('nhận payload hợp lệ, chuẩn hóa uuid về chữ thường, giữ reviewerInputText', () => {
    const out = validateJobPayload(
      'bug-finding-review',
      payload({ requestId: REQUEST.toUpperCase(), reviewerInputText: 'F-04: không sửa' }),
    );
    expect(out).toEqual({ kind: 'bug-finding-review', ...payload(), reviewerInputText: 'F-04: không sửa' });
    expect(validateJobPayload('bug-finding-review', payload())).toEqual({
      kind: 'bug-finding-review',
      ...payload(),
    });
  });

  it.each([
    [{ requestId: 'r-1' }, 'requestId phải là uuid'],
    [{ issueId: 'x' }, 'issueId phải là uuid'],
    [{ identifier: 'tps-1' }, 'identifier không hợp lệ'],
    [{ run: 0 }, 'run phải là số nguyên 1 đến 3'],
    [{ run: 4 }, 'run phải là số nguyên 1 đến 3'],
    [{ run: 1.5 }, 'run phải là số nguyên 1 đến 3'],
    [{ projectId: 'p-1' }, 'projectId phải là uuid'],
    [{ projectKey: 'Bad_Key' }, 'projectKey không hợp lệ'],
    [{ repoPath: 'relative/repo' }, 'repoPath phải là đường tuyệt đối'],
    [{ repoPath: '/a/../b' }, 'repoPath không được chứa ..'],
    [{ provider: 'gitlab' }, 'provider chỉ nhận github'],
    [{ prNumber: 0 }, 'prNumber phải là số nguyên dương'],
    [{ prNumber: -3 }, 'prNumber phải là số nguyên dương'],
    [{ prNumber: '87' }, 'prNumber phải là số nguyên dương'],
    [{ prUrl: 'https://gitlab.com/o/r/-/merge_requests/87' }, 'prUrl không hợp lệ'],
    [{ prUrl: 'https://github.com/o/r/pull/88' }, 'prUrl không khớp prNumber'],
    [{ headSha: 'abc' }, 'headSha phải là 40 ký tự hex'],
    [{ headSha: 'A'.repeat(40) }, 'headSha phải là 40 ký tự hex'],
    [{ baseBranch: '-main' }, 'baseBranch không hợp lệ'],
    [{ reviewerInputText: 5 }, 'reviewerInputText phải là chuỗi'],
    [{ reviewerInputText: 'x'.repeat(20_001) }, 'reviewerInputText quá 20000 ký tự'],
    [{ extra: true }, 'trường extra không được hỗ trợ'],
  ])('từ chối %o', (over, message) => {
    expect(validateJobPayload('bug-finding-review', payload(over))).toBe(message);
  });

  it('reviewerInputText đúng 20 000 ký tự vẫn nhận', () => {
    const out = validateJobPayload('bug-finding-review', payload({ reviewerInputText: 'x'.repeat(20_000) }));
    expect(typeof out).toBe('object');
  });

  it('repoPath là HOME bị chặn như thêm project', () => {
    const p = validateJobPayload('bug-finding-review', payload({ repoPath: '/Users/owner' }));
    if (typeof p === 'string') throw new Error(p);
    expect(machineGuardReason('/Users/owner', p)).not.toBeNull();
    const ok = validateJobPayload('bug-finding-review', payload());
    if (typeof ok === 'string') throw new Error(ok);
    expect(machineGuardReason('/Users/owner', ok)).toBeNull();
  });
});

describe('runBugFindingReview', () => {
  let dir: string;
  let requestsDir: string;
  let repo: string;
  let launches: Array<{ background: boolean }>;
  let syncs: number;
  let recorded: unknown[];
  let launchResult: LaunchResult;

  const deps = (over: Partial<BugFindingReviewDeps> = {}): BugFindingReviewDeps => ({
    home: '/Users/owner',
    requestsDir,
    repoExists: (path) => existsSync(path),
    syncProjects: async () => {
      syncs += 1;
    },
    launch: async (opts) => {
      launches.push(opts);
      return launchResult;
    },
    recordRequest: async (ref) => {
      recorded.push(ref);
    },
    ...over,
  });
  const job = (
    over: Record<string, unknown> = {},
  ): Pick<MachineJob, 'companyId' | 'machineId' | 'kind' | 'payload'> => ({
    companyId: COMPANY,
    machineId: MACHINE,
    kind: 'bug-finding-review',
    payload: payload({ repoPath: repo, ...over }) as MachineJob['payload'],
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bf-review-'));
    requestsDir = join(dir, 'MRReviewQueue', 'crew', 'requests');
    repo = join(dir, 'repo');
    mkdirSync(repo);
    launches = [];
    syncs = 0;
    recorded = [];
    launchResult = { ok: true };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('ghi requests/<requestId>.json đúng hợp đồng CrewReviewRequest rồi mở Bug Finding nền', async () => {
    const outcome = await runBugFindingReview(job({ reviewerInputText: 'F-05: bỏ qua' }), deps());
    expect(outcome).toEqual({ status: 'done', result: { kind: 'bug-finding-review', accepted: true } });
    const file = join(requestsDir, `${REQUEST}.json`);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      schema: 'crew-review-request/1',
      requestId: REQUEST,
      crewProjectId: '44444444-4444-4444-8444-444444444444',
      identifier: 'TPS-645',
      run: 1,
      prNumber: 87,
      headSha: HEAD,
      baseBranch: 'main',
      reviewerInputText: 'F-05: bỏ qua',
    });
    expect(readdirSync(requestsDir)).toEqual([`${REQUEST}.json`]);
    expect(launches).toEqual([{ background: true }]);
    expect(syncs).toBe(1);
    expect(recorded).toEqual([{ requestId: REQUEST, companyId: COMPANY, machineId: MACHINE }]);
  });

  it('chạy lại cùng requestId không ghi lần hai (kể cả khi Bug Finding đã đổi tên thành .json.done)', async () => {
    await runBugFindingReview(job(), deps());
    const file = join(requestsDir, `${REQUEST}.json`);
    writeFileSync(file, 'BẢN ĐÃ CÓ');
    const again = await runBugFindingReview(job({ run: 2 }), deps());
    expect(again).toEqual({ status: 'done', result: { kind: 'bug-finding-review', accepted: true } });
    expect(readFileSync(file, 'utf8')).toBe('BẢN ĐÃ CÓ');

    renameSync(file, `${file}.done`);
    await runBugFindingReview(job(), deps());
    expect(existsSync(file)).toBe(false);
    expect(launches).toHaveLength(3);
  });

  it('repo của project không có trên máy → project_missing, không ghi gì', async () => {
    const outcome = await runBugFindingReview(job({ repoPath: join(dir, 'khong-co') }), deps());
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'project_missing' });
    expect(existsSync(requestsDir)).toBe(false);
    expect(launches).toEqual([]);
  });

  it('không thấy app nhúng → bug_finding_missing, bỏ request vừa ghi', async () => {
    launchResult = { ok: false, reason: 'missing' };
    const outcome = await runBugFindingReview(job(), deps());
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'bug_finding_missing' });
    expect(existsSync(join(requestsDir, `${REQUEST}.json`))).toBe(false);
  });

  it('bản cài riêng cũ đang chạy → standalone_running', async () => {
    launchResult = { ok: false, reason: 'standalone_running' };
    const outcome = await runBugFindingReview(job(), deps());
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'standalone_running' });
    expect(existsSync(join(requestsDir, `${REQUEST}.json`))).toBe(false);
  });

  it('payload sai → app_error, không đụng máy', async () => {
    const outcome = await runBugFindingReview(job({ headSha: 'xyz' }), deps());
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'app_error' });
    expect(outcome.status === 'failed' && outcome.errorText).toContain('headSha phải là 40 ký tự hex');
    expect(launches).toEqual([]);
  });

  it('đồng bộ project lỗi vẫn ghi request (Bug Finding tự đồng bộ lại khi chưa thấy project)', async () => {
    const outcome = await runBugFindingReview(
      job(),
      deps({
        syncProjects: async () => {
          throw new Error('chưa chọn company');
        },
      }),
    );
    expect(outcome.status).toBe('done');
    expect(existsSync(join(requestsDir, `${REQUEST}.json`))).toBe(true);
  });

  it('tiến trình phụ (runJob) không làm việc này: báo app_error', async () => {
    const outcome = await runJob(
      { companyId: COMPANY, kind: 'bug-finding-review', payload: job().payload },
      { projectId: null },
      { home: '/Users/owner' } as never,
    );
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'app_error' });
  });
});
