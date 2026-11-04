import { describe, expect, it } from 'vitest';
import {
  launchBugFinding,
  parseRunningAppPaths,
  runningBugFindingApps,
  trashStandalone,
} from '../src/main/bug-finding/launch';
import { bugFindingPaths, embeddedAppPath, resolveAppPath } from '../src/main/bug-finding/paths';

describe('launchBugFinding', () => {
  const base = {
    embedded: '/A/2P Crew.app/Contents/Resources/Bug Finding.app',
    exists: () => true,
    run: async () => ({ code: 0 }),
  };
  it('không mở bản nhúng khi bản riêng ở /Applications đang chạy', async () => {
    const r = await launchBugFinding(
      { ...base, runningAppPaths: async () => ['/Applications/Bug Finding.app'] },
      { background: false },
    );
    expect(r).toEqual({ ok: false, reason: 'standalone_running' });
  });
  it('mở nền bằng open -g', async () => {
    const calls: string[][] = [];
    const r = await launchBugFinding(
      {
        ...base,
        runningAppPaths: async () => [],
        run: async (a: string[]) => {
          calls.push(a);
          return { code: 0 };
        },
      },
      { background: true },
    );
    expect(r).toEqual({ ok: true });
    expect(calls[0]).toEqual(['/usr/bin/open', '-g', base.embedded]);
  });
  it('báo missing khi không có app nhúng', async () => {
    const r = await launchBugFinding(
      { ...base, exists: () => false, runningAppPaths: async () => [] },
      { background: false },
    );
    expect(r).toEqual({ ok: false, reason: 'missing' });
  });
  it('báo missing khi bản dev không có đường dẫn app', async () => {
    const r = await launchBugFinding(
      { ...base, embedded: null, runningAppPaths: async () => [] },
      { background: false },
    );
    expect(r).toEqual({ ok: false, reason: 'missing' });
  });
  it('mở thường (đưa lên trước) khi bản nhúng đã chạy', async () => {
    const calls: string[][] = [];
    const r = await launchBugFinding(
      {
        ...base,
        runningAppPaths: async () => [base.embedded],
        run: async (a: string[]) => {
          calls.push(a);
          return { code: 0 };
        },
      },
      { background: false },
    );
    expect(r).toEqual({ ok: true });
    expect(calls).toEqual([['/usr/bin/open', base.embedded]]);
  });
  it('open lỗi thì ném lỗi tiếng Việt kèm mã thoát', async () => {
    await expect(
      launchBugFinding(
        { ...base, runningAppPaths: async () => [], run: async () => ({ code: 1 }) },
        { background: false },
      ),
    ).rejects.toThrow('Không mở được Bug Finding (open mã 1)');
  });
});

describe('parseRunningAppPaths', () => {
  it('lấy đường dẫn bundle từ đầu ra pgrep -fl', () => {
    const out = [
      '48211 /Applications/Bug Finding.app/Contents/MacOS/MRReviewQueue',
      '5120 /A/2P Crew.app/Contents/Resources/Bug Finding.app/Contents/MacOS/MRReviewQueue -psn_0',
      '',
    ].join('\n');
    expect(parseRunningAppPaths(out)).toEqual([
      '/Applications/Bug Finding.app',
      '/A/2P Crew.app/Contents/Resources/Bug Finding.app',
    ]);
  });
});

describe('runningBugFindingApps', () => {
  it('hỏi pgrep -fl đúng mẫu tiến trình; không khớp (mã 1) thì rỗng', async () => {
    const calls: Array<[string, readonly string[]]> = [];
    const runner = (code: number, stdout: string) => ({
      run: async (command: string, args: readonly string[]) => {
        calls.push([command, args]);
        return { code, stdout, stderr: '', timedOut: false };
      },
    });
    expect(
      await runningBugFindingApps(
        runner(0, '7 /Applications/Bug Finding.app/Contents/MacOS/MRReviewQueue\n'),
      ),
    ).toEqual(['/Applications/Bug Finding.app']);
    expect(calls[0]).toEqual(['/usr/bin/pgrep', ['-fl', 'Bug Finding.app/Contents/MacOS/MRReviewQueue']]);
    expect(await runningBugFindingApps(runner(1, ''))).toEqual([]);
  });
});

describe('trashStandalone', () => {
  const standalone = '/Applications/Bug Finding.app';
  it('từ chối khi bản cài riêng đang chạy', async () => {
    const trashed: string[] = [];
    const r = await trashStandalone({
      standalonePath: standalone,
      exists: () => true,
      runningAppPaths: async () => [standalone],
      trashItem: async (p) => void trashed.push(p),
    });
    expect(r).toEqual({ ok: false, message: 'Thoát Bug Finding (bản cài riêng) rồi thử lại' });
    expect(trashed).toEqual([]);
  });
  it('chuyển bản cài riêng vào Thùng rác khi không chạy', async () => {
    const trashed: string[] = [];
    const r = await trashStandalone({
      standalonePath: standalone,
      exists: () => true,
      runningAppPaths: async () => [],
      trashItem: async (p) => void trashed.push(p),
    });
    expect(r.ok).toBe(true);
    expect(trashed).toEqual([standalone]);
  });
  it('không còn bản cài riêng thì không làm gì', async () => {
    const r = await trashStandalone({
      standalonePath: standalone,
      exists: () => false,
      runningAppPaths: async () => [],
      trashItem: async () => {
        throw new Error('không được gọi');
      },
    });
    expect(r).toEqual({ ok: true, message: 'Không còn bản cài riêng' });
  });
});

describe('đường dẫn', () => {
  it('khớp hợp đồng cầu nối của Bug Finding', () => {
    expect(bugFindingPaths('/Users/a')).toEqual({
      dataDir: '/Users/a/Library/Application Support/MRReviewQueue',
      bridgeDir: '/Users/a/Library/Application Support/MRReviewQueue/crew',
      projectsFile: '/Users/a/Library/Application Support/MRReviewQueue/crew/projects.json',
      requestsDir: '/Users/a/Library/Application Support/MRReviewQueue/crew/requests',
      responsesDir: '/Users/a/Library/Application Support/MRReviewQueue/crew/responses',
      heartbeatFile: '/Users/a/Library/Application Support/MRReviewQueue/crew/heartbeat.json',
    });
    expect(embeddedAppPath('/A/2P Crew.app/Contents/Resources')).toBe(
      '/A/2P Crew.app/Contents/Resources/Bug Finding.app',
    );
  });
  it('bản đóng gói dùng app nhúng; bản dev lấy CREW_BUG_FINDING_APP, không có thì null', () => {
    expect(resolveAppPath({ isPackaged: true, resourcesPath: '/R', env: {} })).toBe('/R/Bug Finding.app');
    expect(
      resolveAppPath({ isPackaged: false, resourcesPath: '/R', env: { CREW_BUG_FINDING_APP: '/d/BF.app' } }),
    ).toBe('/d/BF.app');
    expect(resolveAppPath({ isPackaged: false, resourcesPath: '/R', env: {} })).toBeNull();
  });
});
