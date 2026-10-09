import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isEnvReadable,
  LSOF_BATCH,
  listProcesses,
  type ProcInfo,
  parseBootTime,
  parseEtime,
  parseLsofCwd,
  parsePsTree,
  readBootTime,
  readCwds,
} from '../src/reaper/process-table.js';
import {
  bridgeRoot,
  orphanCandidates,
  type RunSpec,
  readRunStarts,
  runWindow,
  selectRunMembers,
} from '../src/reaper/run-members.js';
import { FakeRunner } from './helpers/fake-runner.js';

const RUN = '11111111-2222-4333-8444-555555555555';
const OTHER_RUN = '99999999-2222-4333-8444-555555555555';
const ROOT = '/Users/owner/crew-agents/repo-a';
const START = 1_791_000_000;

interface Row extends ProcInfo {
  cwd?: string;
}

function proc(pid: number, ppid: number, pgid: number, extra: Partial<Row> = {}): Row {
  return {
    pid,
    ppid,
    pgid,
    tty: '??',
    startedAt: START + 10,
    comm: 'x',
    command: '',
    runId: null,
    envReadable: false,
    ...extra,
  };
}

/**
 * Bảng process mô phỏng Mac mini lúc chạy một run:
 * sshd → sshd-session → zsh của phiên (600) → claude (601) → zsh của Bash tool (610, session riêng) → make (611);
 * tool đã thoát ra ngoài (700, 701, 702); Terminal và VS Code của owner mở trong worktree; run khác; process cũ.
 */
function table(): Row[] {
  return [
    proc(1, 0, 1, { comm: '/sbin/launchd', startedAt: START - 86_400 }),
    proc(500, 1, 500, { comm: 'sshd: /usr/sbin/sshd -D -f /x [listener]', startedAt: START - 3_600 }),
    proc(501, 500, 501, { comm: 'sshd-session: owner@notty', startedAt: START }),
    proc(600, 501, 600, { comm: 'zsh', cwd: ROOT, startedAt: START }),
    proc(601, 600, 600, {
      comm: 'claude',
      command: 'claude --print --output-format stream-json',
      runId: RUN,
      cwd: ROOT,
    }),
    proc(610, 601, 610, { comm: 'zsh', cwd: ROOT }),
    proc(611, 610, 610, { comm: 'make', cwd: `${ROOT}/pkg` }),
    proc(700, 1, 610, { comm: 'sleep', cwd: ROOT, startedAt: START + 20 }),
    proc(701, 700, 701, { comm: 'node', cwd: `${ROOT}/sub`, startedAt: START + 21 }),
    proc(702, 1, 702, { comm: 'git', cwd: '/users/owner/crew-agents/REPO-A/x', startedAt: START + 22 }),
    // Terminal của owner: có tty, nên cả nó lẫn job nền của nó đều không bị chọn.
    proc(789, 1, 789, { comm: 'Terminal', cwd: '/', startedAt: START - 600 }),
    proc(790, 789, 790, { comm: 'login', tty: 'ttys003', cwd: '/', startedAt: START + 25 }),
    proc(800, 790, 800, { comm: '-zsh', tty: 'ttys003', cwd: ROOT, startedAt: START + 30 }),
    proc(801, 800, 801, { comm: 'npm', cwd: ROOT, startedAt: START + 31 }),
    proc(960, 800, 960, {
      comm: 'claude',
      command: 'claude --resume abc',
      tty: 'ttys003',
      cwd: ROOT,
      startedAt: START + 32,
    }),
    // VS Code của owner: helper không có tty, cwd trong worktree, nhưng cha là app chứ không phải launchd.
    proc(849, 1, 849, { comm: 'Code', cwd: '/', startedAt: START - 600 }),
    proc(850, 849, 850, { comm: 'Code Helper', cwd: ROOT, startedAt: START + 40 }),
    // Process cũ hơn run, worktree khác, tên thư mục trùng tiền tố, run khác.
    proc(900, 1, 900, { comm: 'sleep', cwd: ROOT, startedAt: START - 100 }),
    proc(901, 1, 901, { comm: 'sleep', cwd: '/Users/owner/crew-agents/repo-b', startedAt: START + 50 }),
    proc(903, 1, 903, { comm: 'sleep', cwd: `${ROOT}2`, startedAt: START + 50 }),
    proc(950, 1, 950, {
      comm: 'claude',
      command: 'claude --print',
      runId: OTHER_RUN,
      cwd: '/Users/owner/crew-agents/repo-b',
    }),
    proc(951, 950, 950, { comm: 'zsh', cwd: '/Users/owner/crew-agents/repo-b' }),
  ];
}

const procsOf = (rows: Row[]): ProcInfo[] => rows.map(({ cwd: _cwd, ...p }) => p);
const cwdsOf = (rows: Row[]) =>
  new Map(rows.filter((r) => r.cwd !== undefined).map((r) => [r.pid, r.cwd as string]));

function select(rows: Row[], spec: RunSpec, selfPid = 999): number[] {
  return selectRunMembers(procsOf(rows), spec, selfPid, cwdsOf(rows));
}

const SPEC: RunSpec = {
  runId: RUN,
  root: ROOT,
  started: START,
  nextStarted: null,
  pgid: 600,
  bootTime: null,
};

describe('đọc bảng process (tty, etime) và cwd', () => {
  it('đọc kern.boottime', () => {
    expect(parseBootTime('{ sec = 1791153820, usec = 427391 } Mon Oct  5 05:43:40 2026')).toBe(1_791_153_820);
    expect(parseBootTime('lạ')).toBeNull();
  });

  it('readBootTime gọi sysctl bằng đường dẫn tuyệt đối', async () => {
    const runner = new FakeRunner().on('/usr/sbin/sysctl', () => ({
      stdout: '{ sec = 1791153820, usec = 1 } Mon Oct  5 05:43:40 2026\n',
    }));
    expect(await readBootTime(runner)).toBe(1_791_153_820);
    expect(runner.commands()).toEqual(['/usr/sbin/sysctl -n kern.boottime']);
  });

  it('đổi etime ra giây', () => {
    expect(parseEtime('00:05')).toBe(5);
    expect(parseEtime('01:02:03')).toBe(3_723);
    expect(parseEtime('2-01:02:03')).toBe(2 * 86_400 + 3_723);
    expect(parseEtime('lạ')).toBeNaN();
  });

  it('đọc cột tty và etime trước comm có dấu cách', () => {
    expect(parsePsTree('  501   500   501 ??        01:00 sshd-session: owner@notty').get(501)).toEqual({
      ppid: 500,
      pgid: 501,
      tty: '??',
      elapsedSec: 60,
      comm: 'sshd-session: owner@notty',
    });
  });

  it('đọc cwd từ lsof -Fpn', () => {
    expect(parseLsofCwd(`p600\nfcwd\nn${ROOT}\np601\nfcwd\nn${ROOT}/a b\n`)).toEqual(
      new Map([
        [600, ROOT],
        [601, `${ROOT}/a b`],
      ]),
    );
  });

  it('isEnvReadable chỉ đúng khi ps -E nối thêm env sau argv', () => {
    expect(isEnvReadable('claude -p', 'claude -p HOME=/x')).toBe(true);
    expect(isEnvReadable('claude -p', 'claude -p')).toBe(false);
    expect(isEnvReadable('claude -p', 'khac')).toBe(false);
    expect(isEnvReadable('', 'HOME=/x')).toBe(false);
  });

  it('listProcesses tính thời điểm sinh từ etime và không gọi lsof', async () => {
    const runner = new FakeRunner().on('/bin/ps', (args) => {
      if (args.includes('-E')) return { stdout: `601 claude --print PAPERCLIP_RUN_ID=${RUN} HOME=/h\n` };
      if (args.includes('pid=,command=')) return { stdout: '601 claude --print\n' };
      return { stdout: '  601   600   600 ??        01:40 claude\n' };
    });
    const list = await listProcesses(runner, new Date((START + 200) * 1000));
    expect(list).toEqual([
      {
        pid: 601,
        ppid: 600,
        pgid: 600,
        tty: '??',
        startedAt: START + 100,
        comm: 'claude',
        command: 'claude --print',
        runId: RUN,
        envReadable: true,
      },
    ]);
    expect(runner.commands().some((c) => c.includes('lsof'))).toBe(false);
  });

  it('readCwds chỉ hỏi đúng các pid, theo lô; lsof lỗi một phần vẫn dùng phần đọc được', async () => {
    const runner = new FakeRunner().on('/usr/sbin/lsof', (args) => ({
      code: 1,
      stdout: `p${String(args.at(-1)).split(',')[0]}\nfcwd\nn${ROOT}\n`,
      stderr: 'permission denied',
    }));
    const pids = Array.from({ length: LSOF_BATCH + 1 }, (_, i) => 10_000 + i);
    const cwds = await readCwds(runner, pids);
    expect(runner.calls.length).toBe(2);
    expect(runner.calls[0]?.args.slice(0, 5)).toEqual(['-a', '-d', 'cwd', '-Fpn', '-p']);
    expect(cwds.get(10_000)).toBe(ROOT);
    expect(await readCwds(new FakeRunner(), [])).toEqual(new Map());
  });
});

describe('orphanCandidates', () => {
  it('chỉ đưa đi hỏi cwd các process không tty, sinh trong cửa sổ của run, chưa là con cháu của claude', () => {
    const candidates = orphanCandidates(procsOf(table()), SPEC, 999);
    expect(candidates).toEqual([600, 700, 701, 702, 801, 850, 901, 903, 951]);
  });

  it('không có started thì không có ứng viên nào (không gọi lsof)', () => {
    expect(orphanCandidates(procsOf(table()), { ...SPEC, started: null }, 999)).toEqual([]);
  });
});

describe('selectRunMembers', () => {
  it('chọn con cháu của claude, group đã ghi và tool mồ côi trong worktree; bỏ mọi thứ của owner', () => {
    expect(select(table(), SPEC)).toEqual([600, 601, 610, 611, 700, 701, 702]);
  });

  it('không có pgid (reaper): bỏ zsh của phiên vì cha là sshd-session', () => {
    expect(select(table(), { ...SPEC, pgid: null })).toEqual([601, 610, 611, 700, 701, 702]);
  });

  it('không có started: chỉ còn con cháu của claude', () => {
    expect(select(table(), { ...SPEC, started: null })).toEqual([601, 610, 611]);
  });

  it('claude đã chết: vẫn dọn được tool mồ côi theo cwd', () => {
    const rows = table().filter((p) => p.pid !== 601 && p.pid !== 610 && p.pid !== 611);
    expect(select(rows, { ...SPEC, pgid: null })).toEqual([700, 701, 702]);
  });

  it('Terminal, job nền của Terminal, claude tương tác và VS Code của owner trong worktree không bao giờ bị chọn', () => {
    const pids = select(table(), { ...SPEC, started: START - 3_600 });
    for (const owner of [789, 790, 800, 801, 960, 849, 850]) expect(pids).not.toContain(owner);
  });

  it('không chọn sshd, launchd hay chính mình', () => {
    const pids = select(table(), { ...SPEC, root: '/', started: START - 86_400, pgid: 1 }, 611);
    for (const pid of [1, 500, 501, 611]) expect(pids).not.toContain(pid);
  });

  it('pgid đã ghi bị cấp lại cho group không tty khác của owner: không chọn theo group', () => {
    // Group 1300: helper GUI của owner, sinh sau started, cwd ngoài worktree; leader không sinh lúc run bắt đầu.
    const rows = [
      ...table(),
      proc(1300, 1, 1300, { comm: 'Helper', cwd: '/Applications', startedAt: START + 50 }),
      proc(1301, 1300, 1300, { comm: 'Helper (Renderer)', cwd: '/', startedAt: START + 51 }),
    ];
    const pids = select(rows, { ...SPEC, pgid: 1300 });
    expect(pids).not.toContain(1300);
    expect(pids).not.toContain(1301);
  });

  it('group đã ghi vẫn được chọn khi có thành viên là con cháu của claude dù leader đã chết', () => {
    const rows = table().filter((p) => p.pid !== 610);
    // Leader 610 đã chết: 611 về launchd và cwd ngoài worktree, còn 612 vẫn là con của claude trong group 610.
    const orphaned = rows.map((p) => (p.pid === 611 ? { ...p, ppid: 1, cwd: '/tmp/khac' } : p));
    const withClaudeChild = [...orphaned, proc(612, 601, 610, { comm: 'node', cwd: '/tmp/khac' })];
    const pids = select(withClaudeChild, { ...SPEC, pgid: 610 });
    expect(pids).toContain(611);
    expect(pids).toContain(612);
  });

  it('máy đã khởi động lại sau khi run bắt đầu: chỉ còn con cháu của claude', () => {
    expect(select(table(), { ...SPEC, bootTime: START + 60 })).toEqual([601, 610, 611]);
    expect(orphanCandidates(procsOf(table()), { ...SPEC, bootTime: START + 60 }, 999)).toEqual([]);
  });

  it('thời điểm sinh không đọc được (etime lạ) thì không nằm trong cửa sổ', () => {
    const rows = [...table(), proc(1400, 1, 1400, { comm: 'sleep', cwd: ROOT, startedAt: Number.NaN })];
    expect(select(rows, { ...SPEC, pgid: null })).not.toContain(1400);
  });

  it('hai run cùng worktree: dừng run A muộn không giết mồ côi sinh sau khi run B bắt đầu', () => {
    const B_START = START + 100;
    const rows = [
      ...table().filter((p) => ![601, 610, 611].includes(p.pid)),
      proc(1200, 1, 1200, { comm: 'sleep', cwd: ROOT, startedAt: B_START }),
      proc(1201, 1, 1201, { comm: 'node', cwd: ROOT, startedAt: B_START + 30 }),
    ];
    const pids = select(rows, { ...SPEC, pgid: null, nextStarted: B_START });
    expect(pids).toEqual([700, 701, 702]);
  });
});

/**
 * Chuỗi `ps -axo pid,ppid,etime,command` THẬT của callback bridge Paperclip trên Mac mini (09/10/2026 17:19, run
 * 165a3c6e của assistant 2ps-landing), đường dẫn user thay bằng HOME giả `/Users/owner`.
 */
const REAL_BRIDGE_PS =
  '77461     1    00:16 node /Users/owner/crew-agents/p-2ps-landing/assistant/.paperclip-runtime/claude/paperclip-bridge/server/paperclip-bridge-server.mjs';
const REAL_BRIDGE_ARGV = REAL_BRIDGE_PS.replace(/^\s*\d+\s+\d+\s+\S+\s+/, '');

describe('callback bridge Paperclip', () => {
  it('bridgeRoot nhận bridge theo đường dẫn file bridge trong argv thật và trả worktree', () => {
    expect(bridgeRoot(proc(77461, 1, 77460, { comm: 'node', command: REAL_BRIDGE_ARGV }))).toBe(
      '/Users/owner/crew-agents/p-2ps-landing/assistant',
    );
    expect(
      bridgeRoot(
        proc(1, 1, 1, {
          command: `/opt/homebrew/bin/node ${ROOT}/.paperclip-runtime/claude/paperclip-bridge/server/paperclip-bridge-server.mjs`,
        }),
      ),
    ).toBe(ROOT);
  });

  it('bridgeRoot bỏ qua script node khác, file bridge ngoài .paperclip-runtime và argv có thêm tham số', () => {
    for (const command of [
      'node /Users/owner/app/server.mjs',
      'node /Users/owner/paperclip-bridge-server.mjs',
      `node ${ROOT}/.paperclip-runtime/claude/paperclip-bridge/server/paperclip-bridge-server.mjs --khac`,
      `vim ${ROOT}/.paperclip-runtime/claude/paperclip-bridge/server/paperclip-bridge-server.mjs`,
      '',
    ]) {
      expect(bridgeRoot(proc(5, 1, 5, { command }))).toBeNull();
    }
  });

  it('bridge của worktree không bao giờ được chọn theo giờ, dù sinh trước started 3 giây hay trong cửa sổ của run', () => {
    const bridge = (pid: number, startedAt: number): Row =>
      proc(pid, 1, pid - 1, {
        comm: 'node',
        command: `node ${ROOT}/.paperclip-runtime/claude/paperclip-bridge/server/paperclip-bridge-server.mjs`,
        cwd: ROOT,
        startedAt,
      });
    const rows = [...table(), bridge(590, START - 3), bridge(595, START + 5)];
    expect(orphanCandidates(procsOf(rows), SPEC, 999)).not.toContain(595);
    const picked = select(rows, { ...SPEC, pgid: 589 });
    expect(picked).not.toContain(590);
    expect(picked).not.toContain(595);
    // Cùng group với wrapper đã ghi cũng không chọn: bridge do lượt quét bridge riêng xử lý.
    const sameGroup = [...table(), { ...bridge(596, START + 5), pgid: 600 }];
    expect(select(sameGroup, SPEC)).not.toContain(596);
  });
});

describe('readRunStarts và runWindow', () => {
  it('đọc started của mọi run trong worktree và lấy mốc của run bắt đầu ngay sau', () => {
    const root = mkdtempSync(join(tmpdir(), 'crew-runs-'));
    const runs = join(root, '.paperclip-runtime', 'runs');
    for (const [id, started] of [
      [RUN, START],
      [OTHER_RUN, START + 100],
      ['aaaaaaaa-2222-4333-8444-555555555555', START + 300],
    ] as const) {
      mkdirSync(join(runs, id), { recursive: true });
      writeFileSync(join(runs, id, 'started'), `${started}\n`);
    }
    mkdirSync(join(runs, 'khong-co-started'), { recursive: true });
    writeFileSync(join(runs, 'bbbbbbbb-2222-4333-8444-555555555555'), 'không phải thư mục');
    const starts = readRunStarts(root);
    expect(starts.size).toBe(3);
    expect(runWindow(starts, RUN)).toEqual({ started: START, nextStarted: START + 100 });
    expect(runWindow(starts, 'aaaaaaaa-2222-4333-8444-555555555555')).toEqual({
      started: START + 300,
      nextStarted: null,
    });
    expect(runWindow(starts, 'cccccccc-2222-4333-8444-555555555555')).toEqual({
      started: null,
      nextStarted: null,
    });
    expect(readRunStarts(join(root, 'khong-ton-tai')).size).toBe(0);
  });
});
