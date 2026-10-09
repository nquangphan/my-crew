import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CheckResult } from '@crew/mac';
import { parseUpdateInfo } from 'electron-updater/out/providers/Provider.js';
import { afterEach, describe, expect, it } from 'vitest';
import { type AppState, defaultAppState } from '../src/main/app-state.js';
import {
  type AutoUpdaterLike,
  CHECK_INTERVAL_MS,
  createUpdater,
  DISABLED_UNSIGNED,
  INSTALL_QUIT_TIMEOUT_MS,
  type UpdaterDeps,
} from '../src/main/update/updater.js';

interface UpdateInfoLike {
  version: string;
  files: { url: string }[];
}

/** autoUpdater giả: mỗi hàm ghi lại lời gọi; `feed` quyết định `checkForUpdates` phát sự kiện gì. */
class FakeAutoUpdater extends EventEmitter implements AutoUpdaterLike {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = true;
  allowPrerelease = true;
  calls: string[] = [];
  /** Lỗi Squirrel giả khi `quitAndInstall`: ném đồng bộ. */
  installThrows: Error | null = null;
  feed: () => Promise<UpdateInfoLike | null> = async () => null;
  checkError: Error | null = null;

  async checkForUpdates() {
    this.calls.push('checkForUpdates');
    if (this.checkError) {
      this.emit('error', this.checkError);
      throw this.checkError;
    }
    const info = await this.feed();
    if (info) this.emit('update-available', info);
    else this.emit('update-not-available', {});
    return null;
  }
  async downloadUpdate() {
    this.calls.push('downloadUpdate');
    return [];
  }
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean) {
    this.calls.push(`quitAndInstall:${isSilent}:${isForceRunAfter}`);
    if (this.installThrows) throw this.installThrows;
  }
}

const info = (version: string): UpdateInfoLike => ({
  version,
  files: [{ url: `2P-Crew-${version}-arm64-mac.zip` }, { url: `2P-Crew-${version}-arm64.dmg` }],
});

function harness(opts: {
  disabledReason?: string | null;
  runs?: number;
  drainAnswer?: 'now' | 'later';
  confirm?: boolean;
  previous?: string | null;
  doctor?: CheckResult[];
  state?: Partial<AppState>;
}) {
  const fake = new FakeAutoUpdater();
  const base = defaultAppState('0.1.0');
  let state: AppState = { ...base, ...opts.state, update: { ...base.update, ...opts.state?.update } };
  const order: string[] = [];
  const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
  const timers: Array<{ ms: number; fn: () => void }> = [];
  const once: Array<{ ms: number; fn: () => void; cancelled: boolean }> = [];
  let clock = 0;
  const deps: UpdaterDeps = {
    autoUpdater: () => fake,
    appVersion: '0.1.0',
    disabledReason: opts.disabledReason ?? null,
    store: {
      get: () => structuredClone(state),
      update: async (fn) => {
        state = fn(structuredClone(state));
        order.push(`state:${state.updateState}`);
        return structuredClone(state);
      },
    },
    supervisor: {
      pause: async () => {
        order.push('pause');
      },
      resume: async () => {
        order.push('resume');
      },
      activeRuns: async () => Array.from({ length: opts.runs ?? 0 }, () => ({}) as never),
      stopForQuit: async () => {
        order.push('stopForQuit');
      },
      allowQuitForUpdate: () => {
        order.push('allowQuit');
        return async () => {
          order.push('revoke');
        };
      },
    },
    markers: {
      writePending: (v) => order.push(`pending:${v}`),
      writeCancelled: (v) => order.push(`cancelled:${v}`),
    },
    doctor: async () => opts.doctor ?? [{ id: 'tcc-pending', title: '', status: 'fail', detail: '' }],
    sendStatus: async () => undefined,
    askDrain: async () => {
      order.push('askDrain');
      return opts.drainAnswer ?? 'later';
    },
    confirmRollback: async (n) => {
      order.push(`confirm:${n}`);
      return opts.confirm ?? true;
    },
    snapshotPrevious: async () => {
      order.push('snapshot');
    },
    previousVersion: () => (opts.previous === undefined ? '0.0.9' : opts.previous),
    spawnRollback: (mode, to) => order.push(`helper:${mode}:${to}`),
    exit: (code) => order.push(`exit:${code}`),
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => new Date(Date.UTC(2026, 9, 9, 8, 0, 0) + clock),
    every: (ms, fn) => {
      const timer = { ms, fn };
      timers.push(timer);
      return () => timers.splice(timers.indexOf(timer), 1);
    },
    after: (ms, fn) => {
      const timer = { ms, fn, cancelled: false };
      once.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    log: (_level, event, fields) => events.push({ event, fields }),
  };
  const updater = createUpdater(deps);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { fake, deps, updater, order, events, timers, once, state: () => state, settle };
}

describe('createUpdater', () => {
  it('cấu hình: không tự tải, không tự cài khi thoát, không hạ bản, không prerelease', () => {
    const h = harness({});
    expect(h.fake.autoDownload).toBe(false);
    expect(h.fake.autoInstallOnAppQuit).toBe(false);
    expect(h.fake.allowDowngrade).toBe(false);
    expect(h.fake.allowPrerelease).toBe(false);
  });

  it('bản không ký Developer ID: tắt, nêu lý do, không bao giờ kiểm', async () => {
    const h = harness({ disabledReason: DISABLED_UNSIGNED });
    h.updater.start();
    await h.updater.check();
    expect(h.fake.calls).toEqual([]);
    expect(h.timers).toEqual([]);
    expect(h.updater.view()).toMatchObject({
      enabled: false,
      reason: 'Bản này không ký Developer ID, cập nhật tự động tắt',
      current: '0.1.0',
      previous: '0.0.9',
    });
  });

  it('kiểm lúc khởi động, mỗi 1 giờ và khi bấm', async () => {
    const h = harness({});
    h.updater.start();
    await h.settle();
    expect(h.fake.calls).toEqual(['checkForUpdates']);
    expect(h.timers.map((t) => t.ms)).toEqual([CHECK_INTERVAL_MS]);
    h.timers[0]?.fn();
    await h.settle();
    await h.updater.check();
    expect(h.fake.calls).toEqual(['checkForUpdates', 'checkForUpdates', 'checkForUpdates']);
    expect(h.updater.view().lastCheckedAt).toBe('2026-10-09T08:00:00.000Z');
    h.updater.stop();
    expect(h.timers).toEqual([]);
  });

  it('bản hợp lệ: tải, trạng thái downloading', async () => {
    const h = harness({});
    h.fake.feed = async () => info('0.1.1');
    await h.updater.check();
    expect(h.fake.calls).toEqual(['checkForUpdates', 'downloadUpdate']);
    expect(h.state().updateState).toBe('downloading');
    expect(h.updater.view().available).toBe('0.1.1');
    expect(h.events.map((e) => e.event)).toContain('update-available');
  });

  it('bản trong badVersions: log update-skipped-bad, không tải', async () => {
    const h = harness({ state: { update: { ...defaultAppState('0.1.0').update, badVersions: ['0.1.1'] } } });
    h.fake.feed = async () => info('0.1.1');
    await h.updater.check();
    expect(h.fake.calls).toEqual(['checkForUpdates']);
    expect(h.events.map((e) => e.event)).toEqual(['update-skipped-bad']);
    expect(h.state().updateState).toBe('idle');
    expect(h.updater.view().available).toBeNull();
  });

  it('bản không có zip arm64: không tải', async () => {
    const h = harness({});
    h.fake.feed = async () => ({ version: '0.1.1', files: [{ url: '2P-Crew-0.1.1-x64-mac.zip' }] });
    await h.updater.check();
    expect(h.fake.calls).toEqual(['checkForUpdates']);
  });

  it('tải xong, máy rảnh: baseline, snapshot, watchdog, installing, stopForQuit, quitAndInstall', async () => {
    const h = harness({
      doctor: [
        { id: 'tcc-pending', title: '', status: 'fail', detail: '' },
        { id: 'node', title: '', status: 'ok', detail: '' },
      ],
    });
    h.fake.emit('update-downloaded', info('0.1.1'));
    await h.updater.idle();
    expect(h.state().update.baseline).toEqual(['tcc-pending']);
    expect(h.state().update).toMatchObject({
      from: '0.1.0',
      to: '0.1.1',
      installedAt: '2026-10-09T08:00:00.000Z',
    });
    expect(h.state().updateState).toBe('installing');
    const tail = h.order.slice(h.order.indexOf('pause'));
    expect(tail).toEqual([
      'pause',
      'snapshot',
      'pending:0.1.1',
      'helper:watchdog:0.1.1',
      'state:installing',
      'allowQuit',
      'stopForQuit',
    ]);
    expect(h.fake.calls).toEqual(['quitAndInstall:false:true']);
    // App không thoát trong hạn thì coi như cài hỏng.
    expect(h.once.map((t) => t.ms)).toEqual([INSTALL_QUIT_TIMEOUT_MS]);
    expect(h.events.map((e) => e.event)).toContain('update-downloaded');
  });

  it('baseline ghi thêm send-status khi bản tin máy vốn đã không gửi được', async () => {
    const h = harness({ doctor: [] });
    h.deps.sendStatus = async () => {
      throw new Error('chưa cấu hình');
    };
    h.fake.emit('update-downloaded', info('0.1.1'));
    await h.updater.idle();
    expect(h.state().update.baseline).toEqual(['send-status']);
  });

  it('drain trả later: không cài, giữ waiting-idle, lần kiểm sau cùng bản không hỏi lại', async () => {
    const h = harness({ runs: 2, drainAnswer: 'later' });
    h.fake.emit('update-downloaded', info('0.1.1'));
    await h.updater.idle();
    expect(h.fake.calls).toEqual([]);
    expect(h.state().updateState).toBe('waiting-idle');
    expect(h.order).toContain('askDrain');
    expect(h.order).not.toContain('snapshot');
    const asked = h.order.filter((x) => x === 'askDrain').length;
    h.fake.emit('update-downloaded', info('0.1.1'));
    await h.updater.idle();
    expect(h.order.filter((x) => x === 'askDrain').length).toBe(asked);
  });

  it('"Cài khi rảnh" chạy drain lại cho bản đã tải', async () => {
    const h = harness({ runs: 2, drainAnswer: 'later' });
    h.fake.emit('update-downloaded', info('0.1.1'));
    await h.updater.idle();
    h.deps.supervisor.activeRuns = async () => [];
    await h.updater.installWhenIdle();
    await h.updater.idle();
    expect(h.fake.calls).toEqual(['quitAndInstall:false:true']);
    expect(h.state().updateState).toBe('installing');
  });

  it('"Cài khi rảnh" khi chưa có bản tải về thì báo lỗi', async () => {
    const h = harness({});
    await expect(h.updater.installWhenIdle()).rejects.toThrow('Chưa có bản mới đã tải');
  });

  it('snapshot hỏng: không cài, mở lại listener, về waiting-idle', async () => {
    const h = harness({});
    h.deps.snapshotPrevious = async () => {
      throw new Error('đầy đĩa');
    };
    h.fake.emit('update-downloaded', info('0.1.1'));
    await h.updater.idle();
    expect(h.fake.calls).toEqual([]);
    expect(h.order).toContain('resume');
    expect(h.order).not.toContain('helper:watchdog:0.1.1');
    expect(h.state().updateState).toBe('waiting-idle');
    expect(h.events.map((e) => e.event)).toContain('update-install-aborted');
  });

  it('không kiểm trong lúc đang tải/cài', async () => {
    const h = harness({ state: { updateState: 'installing' } });
    await h.updater.check();
    expect(h.fake.calls).toEqual([]);
  });

  it('lỗi kiểm thì ghi lý do; repo chưa có release thì không coi là lỗi', async () => {
    const h = harness({});
    h.fake.checkError = new Error('net::ERR_INTERNET_DISCONNECTED');
    await h.updater.check();
    expect(h.updater.view().reason).toBe('Lỗi kiểm cập nhật: net::ERR_INTERNET_DISCONNECTED');
    h.fake.checkError = Object.assign(new Error('No published versions on GitHub'), {
      code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS',
    });
    await h.updater.check();
    expect(h.updater.view().reason).toBeNull();
  });

  it('"Cài ngay" khi còn run: cho phép thoát trước khi dừng listener, quit guard không hỏi lại', async () => {
    const h = harness({ runs: 2, drainAnswer: 'now' });
    h.fake.emit('update-downloaded', info('0.1.1'));
    await h.updater.idle();
    const allow = h.order.indexOf('allowQuit');
    expect(allow).toBeGreaterThan(h.order.indexOf('askDrain'));
    expect(allow).toBeLessThan(h.order.indexOf('stopForQuit'));
    expect(h.fake.calls).toEqual(['quitAndInstall:false:true']);
    expect(h.order).not.toContain('revoke');
  });

  it('Squirrel báo lỗi khi cài: hủy giấy phép thoát (listener mở lại), gỡ watchdog, về waiting-idle, không badVersions', async () => {
    const h = harness({});
    h.fake.emit('update-downloaded', info('0.1.1'));
    await h.updater.idle();
    expect(h.state().updateState).toBe('installing');
    h.fake.emit('error', new Error('Code signature did not pass validation'));
    await h.updater.idle();
    const tail = h.order.slice(h.order.indexOf('stopForQuit') + 1);
    expect(tail).toEqual(['cancelled:0.1.1', 'revoke', 'state:waiting-idle']);
    expect(h.state().update.badVersions).toEqual([]);
    expect(h.once[0]?.cancelled).toBe(true);
    expect(h.updater.view().reason).toContain('Cài bản mới lỗi: Code signature did not pass validation');
    expect(h.events.map((e) => e.event)).toContain('update-install-failed');
    // Không kẹt: kiểm lại được, và "Cài khi rảnh" chạy lại lần cài.
    await h.updater.check();
    expect(h.fake.calls).toContain('checkForUpdates');
    await h.updater.installWhenIdle();
    await h.updater.idle();
    expect(h.fake.calls.filter((c) => c.startsWith('quitAndInstall'))).toHaveLength(2);
    expect(h.state().updateState).toBe('installing');
  });

  it('quitAndInstall ném ngay: hủy giấy phép thoát, về waiting-idle', async () => {
    const h = harness({});
    h.fake.installThrows = new Error("No update available, can't quit and install");
    h.fake.emit('update-downloaded', info('0.1.1'));
    await h.updater.idle();
    expect(h.order.slice(h.order.indexOf('stopForQuit') + 1)).toEqual([
      'cancelled:0.1.1',
      'revoke',
      'state:waiting-idle',
    ]);
    expect(h.state().update.badVersions).toEqual([]);
  });

  it('app không thoát trong hạn sau quitAndInstall (Squirrel im lặng): như cài lỗi, cổng không bị bỏ trống', async () => {
    const h = harness({});
    h.fake.emit('update-downloaded', info('0.1.1'));
    await h.updater.idle();
    h.once[0]?.fn();
    await h.updater.idle();
    expect(h.order.slice(h.order.indexOf('stopForQuit') + 1)).toEqual([
      'cancelled:0.1.1',
      'revoke',
      'state:waiting-idle',
    ]);
    expect(h.updater.view().reason).toContain('không thoát');
    // Lỗi đến muộn sau khi đã hủy: không hủy lần hai.
    h.fake.emit('error', new Error('muộn'));
    await h.updater.idle();
    expect(h.order.filter((o) => o === 'revoke')).toHaveLength(1);
  });

  it('quay lui tay khi có run: hỏi; đồng ý thì badVersions, helper now, stopForQuit, exit', async () => {
    const h = harness({ runs: 2, confirm: true });
    await h.updater.rollback();
    expect(h.order).toEqual(['confirm:2', 'state:rolled-back', 'helper:now:0.1.0', 'stopForQuit', 'exit:0']);
    expect(h.state().update.badVersions).toEqual(['0.1.0']);
    expect(h.events.map((e) => e.event)).toEqual(['update-rollback-requested']);
  });

  it('quay lui tay: owner hủy thì không làm gì; không run thì không hỏi', async () => {
    const h = harness({ runs: 1, confirm: false });
    await h.updater.rollback();
    expect(h.order).toEqual(['confirm:1']);
    const h2 = harness({ runs: 0 });
    await h2.updater.rollback();
    expect(h2.order[0]).toBe('state:rolled-back');
  });

  it('quay lui tay khi chưa có previous/: lỗi "Chưa có bản trước"', async () => {
    const h = harness({ previous: null });
    await expect(h.updater.rollback()).rejects.toThrow('Chưa có bản trước');
    expect(h.order).toEqual([]);
  });
});

describe('feed giả qua HTTP local (latest-mac.yml + zip giả)', () => {
  let server: Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  function serve(files: Record<string, string>): Promise<string> {
    const created = createServer((req, res) => {
      const body = files[req.url ?? ''];
      if (body === undefined) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200).end(body);
    });
    server = created;
    return new Promise((resolve) => {
      created.listen(0, '127.0.0.1', () => {
        resolve(`http://127.0.0.1:${(created.address() as AddressInfo).port}`);
      });
    });
  }

  /** autoUpdater giả đọc feed thật: tải `latest-mac.yml`, đọc bằng parser của electron-updater, tải zip. */
  function feedUpdater(base: string): FakeAutoUpdater {
    const fake = new FakeAutoUpdater();
    fake.feed = async () => {
      const response = await fetch(`${base}/latest-mac.yml`);
      const parsed = parseUpdateInfo(
        await response.text(),
        'latest-mac.yml',
        new URL(`${base}/latest-mac.yml`),
      );
      return { version: parsed.version, files: parsed.files.map((f) => ({ url: f.url })) };
    };
    fake.downloadUpdate = async () => {
      fake.calls.push('downloadUpdate');
      const yml = await (await fetch(`${base}/latest-mac.yml`)).text();
      const parsed = parseUpdateInfo(yml, 'latest-mac.yml', new URL(`${base}/latest-mac.yml`));
      const zip = parsed.files.find((f) => f.url.endsWith('.zip'));
      const response = await fetch(`${base}/${zip?.url}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await response.arrayBuffer();
      fake.emit('update-downloaded', { version: parsed.version, files: parsed.files });
      return [];
    };
    return fake;
  }

  const yml = (version: string, arch: string) =>
    [
      `version: ${version}`,
      'files:',
      `  - url: 2P-Crew-${version}-${arch}-mac.zip`,
      '    sha512: AAAA',
      '    size: 4',
      `  - url: 2P-Crew-${version}-${arch}.dmg`,
      '    sha512: BBBB',
      '    size: 4',
      `path: 2P-Crew-${version}-${arch}-mac.zip`,
      'sha512: AAAA',
      "releaseDate: '2026-10-09T06:27:26.282Z'",
      '',
    ].join('\n');

  it('bản tăng arm64: tải zip, drain, cài', async () => {
    const base = await serve({
      '/latest-mac.yml': yml('0.1.1', 'arm64'),
      '/2P-Crew-0.1.1-arm64-mac.zip': 'PK..',
    });
    const h = harness({});
    const fake = feedUpdater(base);
    const updater = createUpdater({ ...h.deps, autoUpdater: () => fake });
    await updater.check();
    await updater.idle();
    expect(fake.calls).toEqual(['checkForUpdates', 'downloadUpdate', 'quitAndInstall:false:true']);
    expect(h.state().update.to).toBe('0.1.1');
  });

  it('feed chỉ có x64 hay bản cũ hơn: không tải', async () => {
    const base = await serve({ '/latest-mac.yml': yml('0.1.1', 'x64') });
    const h = harness({});
    const fake = feedUpdater(base);
    const updater = createUpdater({ ...h.deps, autoUpdater: () => fake });
    await updater.check();
    expect(fake.calls).toEqual(['checkForUpdates']);

    server?.close();
    const base2 = await serve({ '/latest-mac.yml': yml('0.0.9', 'arm64') });
    const fake2 = feedUpdater(base2);
    const updater2 = createUpdater({ ...h.deps, autoUpdater: () => fake2 });
    await updater2.check();
    expect(fake2.calls).toEqual(['checkForUpdates']);
  });
});
