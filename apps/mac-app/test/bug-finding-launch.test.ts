import { describe, expect, it } from 'vitest';
import {
  checkLaunch,
  createLaunchGate,
  launchBugFinding,
  OPEN_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
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
    expect(r).toEqual({ ok: false, reason: 'standalone_running', paths: ['/Applications/Bug Finding.app'] });
  });
  it('kiểm trước (checkLaunch) không chạy open', async () => {
    const calls: string[][] = [];
    const deps = {
      ...base,
      runningAppPaths: async () => ['/Volumes/DMG/2P Crew.app/Contents/Resources/Bug Finding.app'],
      run: async (a: string[]) => {
        calls.push(a);
        return { code: 0 };
      },
    };
    expect(await checkLaunch(deps)).toEqual({
      ok: false,
      reason: 'standalone_running',
      paths: ['/Volumes/DMG/2P Crew.app/Contents/Resources/Bug Finding.app'],
    });
    expect(calls).toEqual([]);
  });
  it('open quá hạn thì ném lỗi rõ ràng', async () => {
    await expect(
      launchBugFinding(
        { ...base, runningAppPaths: async () => [], run: async () => ({ code: 137, timedOut: true }) },
        { background: true },
      ),
    ).rejects.toThrow(`open quá ${OPEN_TIMEOUT_MS / 1000} giây`);
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
  it('lấy đường dẫn bundle từ cột comm của ps', () => {
    const out = [
      '48211 /Applications/Bug Finding.app/Contents/MacOS/MRReviewQueue',
      ' 5120 /A/2P Crew.app/Contents/Resources/Bug Finding.app/Contents/MacOS/MRReviewQueue',
      '  437 /System/Library/CoreServices/loginwindow.app/Contents/MacOS/loginwindow',
      '',
    ].join('\n');
    expect(parseRunningAppPaths(out)).toEqual([
      '/Applications/Bug Finding.app',
      '/A/2P Crew.app/Contents/Resources/Bug Finding.app',
    ]);
  });
  it('lệnh khác nhận đường dẫn binary Bug Finding làm tham số không bị tính (comm chỉ là chương trình)', () => {
    // `codesign -v '/A/Bug Finding.app/Contents/MacOS/MRReviewQueue'` hiện trong comm của ps chỉ là /usr/bin/codesign.
    expect(parseRunningAppPaths('9 /usr/bin/codesign\n10 /usr/bin/lldb\n')).toEqual([]);
  });
});

describe('runningBugFindingApps', () => {
  const runner = (out: { code: number; stdout?: string; timedOut?: boolean }, calls: unknown[] = []) => ({
    run: async (command: string, args: readonly string[], options?: { timeoutMs?: number }) => {
      calls.push([command, args, options]);
      return { code: out.code, stdout: out.stdout ?? '', stderr: '', timedOut: out.timedOut ?? false };
    },
  });
  it('hỏi ps (có hạn) và lấy bundle Bug Finding', async () => {
    const calls: unknown[] = [];
    expect(
      await runningBugFindingApps(
        runner({ code: 0, stdout: '7 /Applications/Bug Finding.app/Contents/MacOS/MRReviewQueue\n' }, calls),
      ),
    ).toEqual(['/Applications/Bug Finding.app']);
    expect(calls[0]).toEqual(['/bin/ps', ['-axo', 'pid=,comm='], { timeoutMs: PROBE_TIMEOUT_MS }]);
  });
  it('ps lỗi hay quá hạn thì ném, không coi là không chạy', async () => {
    await expect(runningBugFindingApps(runner({ code: 2 }))).rejects.toThrow('ps lỗi (mã 2)');
    await expect(runningBugFindingApps(runner({ code: 137, timedOut: true }))).rejects.toThrow('quá');
  });
});

describe('createLaunchGate', () => {
  it('cổng đóng thì không chạy việc mới; close chờ việc đang chạy xong', async () => {
    const gate = createLaunchGate();
    let release: () => void = () => undefined;
    const events: string[] = [];
    const running = gate.run(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('xong');
        }),
      () => 'đóng',
    );
    let closed = false;
    const closing = gate.close().then(() => {
      closed = true;
    });
    expect(
      await gate.run(
        async () => 'chạy',
        () => 'đóng',
      ),
    ).toBe('đóng');
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    expect(await running).toBe('xong');
    await closing;
    expect(closed).toBe(true);
    gate.open();
    expect(
      await gate.run(
        async () => 'chạy',
        () => 'đóng',
      ),
    ).toBe('chạy');
    expect(events).toEqual([]);
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
