import { describe, expect, it, vi } from 'vitest';
import { PaperclipAuthError, PaperclipForbiddenError } from '../src/main/paperclip/client.js';
import { createRuns } from '../src/main/runs.js';
import type { ActiveRun } from '../src/shared/ipc-contract.js';

const run: ActiveRun = { pid: 10, runId: 'r1', worktree: '/w/exec-1', startedAt: 1, children: 2 };

function make(overrides: Partial<Parameters<typeof createRuns>[0]> = {}) {
  const cancelRun = vi.fn(async (_id: string) => undefined);
  const openExternal = vi.fn(async (_url: string) => undefined);
  const deps = {
    activeRuns: async () => [run],
    client: () => ({
      cancelRun,
      runWebUrl: async (id: string) => `https://p.example/TPS/agents/a1/runs/${id}`,
    }),
    openExternal,
    ...overrides,
  };
  return { runs: createRuns(deps), cancelRun, openExternal };
}

describe('runs', () => {
  it('list trả activeRuns', async () => {
    expect(await make().runs.list()).toEqual([run]);
  });

  it('cancel gọi REST đúng một lần và không kill process', async () => {
    const kill = vi.spyOn(process, 'kill');
    const { runs, cancelRun } = make();
    expect(await runs.cancel('r1')).toEqual({ ok: true, message: 'Đã gửi lệnh hủy, Paperclip sẽ dừng run.' });
    expect(cancelRun).toHaveBeenCalledTimes(1);
    expect(cancelRun).toHaveBeenCalledWith('r1');
    expect(kill).not.toHaveBeenCalled();
    kill.mockRestore();
  });

  it('401 hoặc chưa đăng nhập thì báo cần đăng nhập lại', async () => {
    const auth = make({
      client: () => ({
        cancelRun: async () => {
          throw new PaperclipAuthError();
        },
        runWebUrl: async () => '',
      }),
    });
    expect(await auth.runs.cancel('r1')).toEqual({
      ok: false,
      message: 'Cần đăng nhập lại Paperclip (mục Cài đặt).',
    });
    const none = make({
      client: () => {
        throw new Error('Chưa đăng nhập Paperclip');
      },
    });
    expect((await none.runs.cancel('r1')).message).toBe('Cần đăng nhập lại Paperclip (mục Cài đặt).');
  });

  it('403 (tài khoản không thuộc company) báo không có quyền, không bảo đăng nhập lại', async () => {
    const { runs } = make({
      client: () => ({
        cancelRun: async () => {
          throw new PaperclipForbiddenError();
        },
        runWebUrl: async () => '',
      }),
    });
    const answer = await runs.cancel('r1');
    expect(answer.ok).toBe(false);
    expect(answer.message).toContain('không có quyền');
    expect(answer.message).not.toContain('đăng nhập lại');
  });

  it('lỗi khác thì ok false kèm lý do', async () => {
    const { runs } = make({
      client: () => ({
        cancelRun: async () => {
          throw new Error('Paperclip trả HTTP 500');
        },
        runWebUrl: async () => '',
      }),
    });
    expect(await runs.cancel('r1')).toEqual({
      ok: false,
      message: 'Không hủy được run: Paperclip trả HTTP 500',
    });
  });

  it('openWeb mở link web của run', async () => {
    const { runs, openExternal } = make();
    expect(await runs.openWeb('r1')).toEqual({ ok: true, message: 'Đã mở run trên web.' });
    expect(openExternal).toHaveBeenCalledWith('https://p.example/TPS/agents/a1/runs/r1');
  });

  it('openWeb chưa đăng nhập thì không mở', async () => {
    const { runs, openExternal } = make({
      client: () => {
        throw new Error('Chưa đăng nhập Paperclip');
      },
    });
    expect((await runs.openWeb('r1')).ok).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });
});
