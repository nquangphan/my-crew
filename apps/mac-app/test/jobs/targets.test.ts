import { describe, expect, it, vi } from 'vitest';
import { MissingKeyError } from '../../src/main/jobs/poller.js';
import { createTargetResolver, type TargetResolverDeps } from '../../src/main/jobs/targets.js';

const MACHINE = '55555555-5555-4555-8555-555555555555';
const TPS = '11111111-1111-4111-8111-111111111111';
const E2E = '22222222-2222-4222-8222-222222222222';
const BOARD = 'https://crew.example.com';

function make(over: Partial<TargetResolverDeps> = {}) {
  const companies = vi.fn(async (_origin: string) => [{ id: TPS, name: 'TPS' }]);
  const deps: TargetResolverDeps = {
    statusTargets: async () => ({
      machineId: MACHINE,
      targets: [
        { url: 'http://100.105.105.12:3100', companyId: TPS },
        { url: BOARD, companyId: E2E },
      ],
    }),
    origin: () => BOARD,
    companies,
    ...over,
  };
  return { resolver: createTargetResolver(deps), companies };
}

describe('createTargetResolver', () => {
  it('hỏi việc ở origin board đã đăng nhập, không theo URL đích bản tin (đích Tailscale vẫn nhận việc)', async () => {
    const { resolver, companies } = make();
    const resolved = await resolver.resolve();
    expect(companies).toHaveBeenCalledWith(BOARD);
    expect(resolved.machineId).toBe(MACHINE);
    expect(resolved.targets).toEqual([{ url: BOARD, companyId: TPS, name: 'TPS' }]);
  });

  it('company tài khoản không có quyền thì bỏ qua và ghi lý do, không hỏi việc', async () => {
    const { resolver } = make();
    const resolved = await resolver.resolve();
    expect(resolved.targets.map((t) => t.companyId)).toEqual([TPS]);
    expect(resolved.skipped).toEqual([{ companyId: E2E, reason: expect.stringContaining('không có quyền') }]);
  });

  it('hai đích cùng company chỉ hỏi một lần', async () => {
    const { resolver } = make({
      statusTargets: async () => ({
        machineId: MACHINE,
        targets: [
          { url: 'http://100.105.105.12:3100', companyId: TPS },
          { url: BOARD, companyId: TPS.toUpperCase() },
        ],
      }),
    });
    expect((await resolver.resolve()).targets).toHaveLength(1);
  });

  it('chưa đăng nhập board (không có origin) → MissingKeyError, không gọi server', async () => {
    const { resolver, companies } = make({ origin: () => null });
    await expect(resolver.resolve()).rejects.toBeInstanceOf(MissingKeyError);
    expect(companies).not.toHaveBeenCalled();
  });

  it('không có đích bản tin thì không gọi server', async () => {
    const { resolver, companies } = make({
      statusTargets: async () => ({ machineId: MACHINE, targets: [] }),
    });
    expect(await resolver.resolve()).toEqual({ machineId: MACHINE, targets: [], skipped: [] });
    expect(companies).not.toHaveBeenCalled();
  });

  it('danh sách company nhớ 60 giây; invalidate() thì đọc lại; lỗi không được nhớ', async () => {
    let now = 0;
    const companies = vi
      .fn<(origin: string) => Promise<Array<{ id: string; name: string }>>>()
      .mockRejectedValueOnce(new Error('mạng'))
      .mockResolvedValue([{ id: TPS, name: 'TPS' }]);
    const { resolver } = make({ companies, now: () => now });
    await expect(resolver.resolve()).rejects.toThrow('mạng');
    await resolver.resolve();
    await resolver.resolve();
    expect(companies).toHaveBeenCalledTimes(2);
    now = 61_000;
    await resolver.resolve();
    expect(companies).toHaveBeenCalledTimes(3);
    resolver.invalidate();
    await resolver.resolve();
    expect(companies).toHaveBeenCalledTimes(4);
  });

  it('đổi origin board thì đọc lại danh sách company', async () => {
    let origin = BOARD;
    const { resolver, companies } = make({ origin: () => origin });
    await resolver.resolve();
    origin = 'https://other.example.com';
    await resolver.resolve();
    expect(companies).toHaveBeenCalledTimes(2);
    expect(companies).toHaveBeenLastCalledWith('https://other.example.com');
  });
});
