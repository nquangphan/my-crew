import { describe, expect, it } from 'vitest';
import {
  extractRunId,
  listProcesses,
  type ProcInfo,
  parsePsCommands,
  parsePsTree,
} from '../src/reaper/process-table.js';
import { isClaudePrint, isOrphaned, selectTargets } from '../src/reaper/select.js';
import { FakeRunner } from './helpers/fake-runner.js';

const TREE = [
  '    1     0     1 /sbin/launchd',
  '17611     1 17611 sshd: /usr/sbin/sshd -D -f /Users/owner/.crew-mac/sshd/sshd_config [listener] 0 of 10-100 startups',
  '71433 17611 71433 sshd-session: owner [priv]',
  '71435 71433 71433 sshd-session: owner@notty',
  '71436 71435 71436 zsh',
  '71440 71436 71436 claude',
  '80000     1 80000 zsh',
  '80001 80000 80000 claude',
  '80002 80001 80000 git',
  '90000 57355 90000 claude',
].join('\n');

// Argv không kèm env (`ps -axww -o pid=,command=`).
const ARGV = [
  '71440 claude --print --output-format stream-json',
  '80001 claude --print --output-format stream-json',
  '80002 git status',
  '90000 claude --dangerously-skip-permissions',
].join('\n');

const ENV = [
  '71440 claude --print --output-format stream-json PAPERCLIP_RUN_ID=run-live HOME=/Users/owner',
  '80001 claude --print --output-format stream-json PAPERCLIP_RUN_ID=run-dead HOME=/Users/owner',
  '80002 git status',
  '90000 claude --dangerously-skip-permissions HOME=/Users/owner',
].join('\n');

function procs(): ProcInfo[] {
  const argv = parsePsCommands(ARGV);
  const env = parsePsCommands(ENV);
  return [...parsePsTree(TREE)].map(([pid, t]) => {
    const command = argv.get(pid) ?? '';
    return { pid, ...t, command, runId: extractRunId(command, env.get(pid) ?? '') };
  });
}

const byPid = (list: ProcInfo[]) => new Map(list.map((p) => [p.pid, p]));
const at = (iso: string) => new Date(iso);

describe('đọc bảng process', () => {
  it('tách pid, ppid, pgid và comm có dấu cách', () => {
    expect(parsePsTree(TREE).get(71435)).toEqual({
      ppid: 71433,
      pgid: 71433,
      comm: 'sshd-session: owner@notty',
    });
  });

  it('chỉ lấy PAPERCLIP_RUN_ID trong phần env, sau argv', () => {
    expect(extractRunId('claude --print', 'claude --print PAPERCLIP_RUN_ID=abc-123 X=1')).toBe('abc-123');
    expect(extractRunId('claude --print', 'claude --print XPAPERCLIP_RUN_ID=abc')).toBeNull();
    expect(extractRunId('claude --print', 'claude --print')).toBeNull();
  });

  it('PAPERCLIP_RUN_ID nằm trong argv (prompt) mà env không có thì không phải run', () => {
    const argv = 'claude -p giải thích vì sao PAPERCLIP_RUN_ID=abc-123 bị lỗi';
    expect(extractRunId(argv, `${argv} HOME=/Users/owner`)).toBeNull();
    expect(extractRunId(argv, `${argv} HOME=/Users/owner PAPERCLIP_RUN_ID=run-that`)).toBe('run-that');
  });

  it('argv rỗng hoặc không khớp đầu chuỗi env thì không đoán', () => {
    expect(extractRunId('', 'PAPERCLIP_RUN_ID=abc')).toBeNull();
    expect(extractRunId('claude -p a', 'claude -p b PAPERCLIP_RUN_ID=abc')).toBeNull();
  });

  it('listProcesses gọi ps ba lần và ghép theo pid', async () => {
    const runner = new FakeRunner().on('/bin/ps', (args) => ({
      stdout: args.includes('-E') ? ENV : args.includes('pid=,command=') ? ARGV : TREE,
    }));
    const list = await listProcesses(runner);
    const dead = list.find((p) => p.pid === 80001);
    expect(dead?.runId).toBe('run-dead');
    expect(dead?.command).toBe('claude --print --output-format stream-json');
    expect(runner.commands()).toEqual([
      '/bin/ps -axww -o pid=,ppid=,pgid=,comm=',
      '/bin/ps -axww -o pid=,command=',
      '/bin/ps -E -axww -o pid=,command=',
    ]);
  });
});

describe('chọn process mồ côi', () => {
  it('chỉ nhận claude --print có run id', () => {
    const map = byPid(procs());
    expect(isClaudePrint(map.get(71440) as ProcInfo)).toBe(true);
    expect(isClaudePrint(map.get(90000) as ProcInfo)).toBe(false);
  });

  it('còn sshd-session trong chuỗi tổ tiên thì không mồ côi, kể cả khi cha trực tiếp sống', () => {
    const map = byPid(procs());
    expect(isOrphaned(map.get(71440) as ProcInfo, map)).toBe(false);
    expect(isOrphaned(map.get(80001) as ProcInfo, map)).toBe(true);
  });

  it('lần đầu thấy mồ côi thì chỉ ghi lại thời điểm', () => {
    const { targets, nextState } = selectTargets(
      procs(),
      { orphanSince: {} },
      at('2026-10-06T07:00:00Z'),
      60_000,
      999,
    );
    expect(targets).toEqual([]);
    expect(nextState).toEqual({ orphanSince: { '80001:run-dead': '2026-10-06T07:00:00.000Z' } });
  });

  it('chưa đủ 60 giây thì chưa chọn', () => {
    const state = { orphanSince: { '80001:run-dead': '2026-10-06T07:00:00.000Z' } };
    const { targets } = selectTargets(procs(), state, at('2026-10-06T07:00:59Z'), 60_000, 999);
    expect(targets).toEqual([]);
  });

  it('quá hạn thì chọn claude, process con và process cùng group có cùng run id', () => {
    const state = { orphanSince: { '80001:run-dead': '2026-10-06T07:00:00.000Z' } };
    const { targets } = selectTargets(procs(), state, at('2026-10-06T07:01:00Z'), 60_000, 999);
    expect(targets).toEqual([
      {
        pid: 80001,
        runId: 'run-dead',
        pgid: 80000,
        pids: [80001, 80002],
        killGroup: true,
        strays: [],
        orphanSince: '2026-10-06T07:00:00.000Z',
      },
    ]);
  });

  it('không bao giờ chọn phiên claude tương tác của owner', () => {
    const list = procs().map((p) => (p.pid === 90000 ? { ...p, ppid: 1 } : p));
    const { targets, nextState } = selectTargets(
      list,
      { orphanSince: {} },
      at('2026-10-06T09:00:00Z'),
      0,
      999,
    );
    expect(targets.map((t) => t.pid)).toEqual([80001]);
    expect(Object.keys(nextState.orphanSince)).toEqual(['80001:run-dead']);
  });

  it('không chọn chính process reaper, và không giết theo group khi reaper cùng group', () => {
    const { targets } = selectTargets(procs(), { orphanSince: {} }, at('2026-10-06T07:00:00Z'), 0, 80002);
    expect(targets[0]?.pids).toEqual([80001]);
    expect(targets[0]?.killGroup).toBe(false);
  });

  it('group có phiên claude không mang run id thì không giết theo group, chỉ giết từng pid', () => {
    const list = [
      ...procs(),
      {
        pid: 80003,
        ppid: 1,
        pgid: 80000,
        comm: 'claude',
        command: 'claude --resume abc HOME=/Users/owner',
        runId: null,
      },
    ];
    const { targets } = selectTargets(list, { orphanSince: {} }, at('2026-10-06T07:00:00Z'), 0, 999);
    expect(targets[0]?.killGroup).toBe(false);
    expect(targets[0]?.pids).toEqual([80001, 80002]);
  });

  it('group có process của run khác thì không giết theo group', () => {
    const list = [
      ...procs(),
      {
        pid: 80004,
        ppid: 1,
        pgid: 80000,
        comm: 'node',
        command: 'node x PAPERCLIP_RUN_ID=run-other',
        runId: 'run-other',
      },
    ];
    const { targets } = selectTargets(list, { orphanSince: {} }, at('2026-10-06T07:00:00Z'), 0, 999);
    expect(targets.find((t) => t.runId === 'run-dead')?.killGroup).toBe(false);
  });

  it('process con đã đổi sang group khác được ghi riêng để vẫn bị dọn', () => {
    const list = [
      ...procs(),
      { pid: 80005, ppid: 80001, pgid: 80005, comm: 'node', command: 'node mcp', runId: null },
    ];
    const { targets } = selectTargets(list, { orphanSince: {} }, at('2026-10-06T07:00:00Z'), 0, 999);
    expect(targets[0]?.pids).toEqual([80001, 80002, 80005]);
    expect(targets[0]?.strays).toEqual([{ pid: 80005, pgid: 80005 }]);
    expect(targets[0]?.killGroup).toBe(true);
  });

  it('claude -p của owner chạy từ Terminal, prompt có chữ PAPERCLIP_RUN_ID= nhưng env không có: không chọn', async () => {
    const argvLine = '95000 claude -p giải thích vì sao PAPERCLIP_RUN_ID=abc-123 bị lỗi';
    const runner = new FakeRunner().on('/bin/ps', (args) => ({
      stdout: args.includes('-E')
        ? `${ENV}\n${argvLine} HOME=/Users/owner TERM_PROGRAM=Apple_Terminal`
        : args.includes('pid=,command=')
          ? `${ARGV}\n${argvLine}`
          : `${TREE}\n95000     1 95000 claude`,
    }));
    const list = await listProcesses(runner);
    const { targets } = selectTargets(list, { orphanSince: {} }, at('2026-10-06T07:00:00Z'), 0, 999);
    expect(targets.map((t) => t.pid)).toEqual([80001]);
  });

  it('bỏ entry state của process đã hết mồ côi hoặc đã chết', () => {
    const state = { orphanSince: { '12345:run-old': '2026-10-06T06:00:00.000Z' } };
    const { nextState } = selectTargets(procs(), state, at('2026-10-06T07:00:00Z'), 60_000, 999);
    expect(nextState.orphanSince['12345:run-old']).toBeUndefined();
  });
});
