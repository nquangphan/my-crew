import { describe, expect, it } from 'vitest';
import { CreateSubtaskRequest, UpdateTestPlanRequest } from './api-schemas.js';

const PARENT_ID = '00000000-0000-4000-8000-000000000001';
const PAIRS_WITH = '00000000-0000-4000-8000-000000000002';

const issuesOf = (input: unknown) => {
  const result = CreateSubtaskRequest.safeParse(input);
  if (result.success) throw new Error('expected validation to fail');
  return result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
};

const RATED = { complexity: 'small', complexityReason: 'Việc nhỏ' } as const;

describe('CreateSubtaskRequest testKinds/testReason', () => {
  it('accepts a qc ticket with a valid test plan', () => {
    const result = CreateSubtaskRequest.safeParse({
      type: 'qc',
      parentId: PARENT_ID,
      title: 'QC giỏ hàng',
      pairsWith: PAIRS_WITH,
      ...RATED,
      testKinds: ['api', 'integration'],
      testReason: 'Chỉ đổi API, không đụng UI',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a qc ticket with no test plan (legacy daemon)', () => {
    const result = CreateSubtaskRequest.safeParse({
      type: 'qc',
      parentId: PARENT_ID,
      title: 'QC giỏ hàng',
      pairsWith: PAIRS_WITH,
      ...RATED,
    });
    expect(result.success).toBe(true);
  });

  it('refuses an empty testKinds array, naming only that field', () => {
    expect(
      issuesOf({
        type: 'qc',
        parentId: PARENT_ID,
        title: 'QC',
        pairsWith: PAIRS_WITH,
        ...RATED,
        testKinds: [],
        testReason: 'lý do',
      }),
    ).toEqual([{ path: 'testKinds', message: expect.stringContaining('không được rỗng') }]);
  });

  it('refuses a duplicate test kind, naming only that field', () => {
    expect(
      issuesOf({
        type: 'qc',
        parentId: PARENT_ID,
        title: 'QC',
        pairsWith: PAIRS_WITH,
        ...RATED,
        testKinds: ['api', 'api'],
        testReason: 'lý do',
      }),
    ).toEqual([{ path: 'testKinds', message: expect.stringContaining('không được trùng') }]);
  });

  it('refuses a value outside the TestKind enum', () => {
    const issues = issuesOf({
      type: 'qc',
      parentId: PARENT_ID,
      title: 'QC',
      pairsWith: PAIRS_WITH,
      ...RATED,
      testKinds: ['e2e_smoke'],
      testReason: 'lý do',
    });
    expect(issues.every((issue) => issue.path.startsWith('testKinds'))).toBe(true);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('refuses testKinds without testReason, naming only testReason', () => {
    expect(
      issuesOf({
        type: 'qc',
        parentId: PARENT_ID,
        title: 'QC',
        pairsWith: PAIRS_WITH,
        ...RATED,
        testKinds: ['api'],
      }),
    ).toEqual([{ path: 'testReason', message: expect.stringContaining('bắt buộc khi có testKinds') }]);
  });

  it('refuses testReason without testKinds, naming only testKinds', () => {
    expect(
      issuesOf({
        type: 'qc',
        parentId: PARENT_ID,
        title: 'QC',
        pairsWith: PAIRS_WITH,
        ...RATED,
        testReason: 'lý do',
      }),
    ).toEqual([{ path: 'testKinds', message: expect.stringContaining('bắt buộc khi có testReason') }]);
  });

  it('refuses testKinds/testReason on a dev ticket, naming only the set fields', () => {
    expect(
      issuesOf({
        type: 'dev',
        parentId: PARENT_ID,
        title: 'Dev',
        ...RATED,
        testKinds: ['api'],
        testReason: 'lý do',
      }),
    ).toEqual([
      { path: 'testKinds', message: expect.stringContaining('type: qc') },
      { path: 'testReason', message: expect.stringContaining('type: qc') },
    ]);
  });

  it('refuses testKinds alone on a dev ticket, naming only testKinds', () => {
    expect(
      issuesOf({
        type: 'dev',
        parentId: PARENT_ID,
        title: 'Dev',
        ...RATED,
        testKinds: ['api'],
      }),
    ).toEqual([{ path: 'testKinds', message: expect.stringContaining('type: qc') }]);
  });
});

describe('UpdateTestPlanRequest', () => {
  it('accepts a valid test plan change', () => {
    const result = UpdateTestPlanRequest.safeParse({
      ticket: 'WEB-5',
      testKinds: ['ui_web'],
      testReason: 'Cần kiểm giao diện checkout',
    });
    expect(result.success).toBe(true);
  });

  it('requires both testKinds (non-empty, no dup) and testReason', () => {
    expect(UpdateTestPlanRequest.safeParse({ ticket: 'WEB-5' }).success).toBe(false);
    expect(UpdateTestPlanRequest.safeParse({ ticket: 'WEB-5', testKinds: [], testReason: 'x' }).success).toBe(
      false,
    );
    expect(
      UpdateTestPlanRequest.safeParse({ ticket: 'WEB-5', testKinds: ['api', 'api'], testReason: 'x' })
        .success,
    ).toBe(false);
    expect(
      UpdateTestPlanRequest.safeParse({ ticket: 'WEB-5', testKinds: ['api'], testReason: '   ' }).success,
    ).toBe(false);
  });
});
