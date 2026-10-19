import { describe, expect, it } from 'vitest';
import { listProcesses } from '../src/reaper/process-table.js';
import { stopMembers } from '../src/reaper/stop.js';
import { FakeRunner } from './helpers/fake-runner.js';

const NOW = new Date('2026-10-06T07:05:00.000Z');

// Cột: pid ppid pgid tty etime comm. 600 là zsh của phiên (không được chọn), 610 là group riêng của Bash tool.
const BEFORE = [
  '    1     0     1 ??       10-00:00:00 /sbin/launchd',
  '  600   501   600 ??             02:00 zsh',
  '  601   600   600 ??             01:50 claude',
  '  610   601   610 ??             01:00 zsh',
  '  611   610   610 ??             00:50 make',
].join('\n');

function harness(trees: string[], selfPid = 999) {
  let call = 0;
  const runner = new FakeRunner().on('/bin/ps', (args) => {
    if (args.includes('pid=,command=')) return { stdout: '' };
    const tree = trees[Math.min(call, trees.length - 1)] as string;
    call++;
    return { stdout: tree };
  });
  const signals: string[] = [];
  const sleeps: number[] = [];
  const deps = {
    runner,
    signal: (pid: number, sig: 'SIGTERM' | 'SIGKILL') => {
      signals.push(`${sig} ${pid}`);
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    now: () => NOW,
    selfPid,
  };
  return { deps, signals, sleeps };
}

async function run(trees: string[], members: number[], selfPid = 999) {
  const h = harness(trees, selfPid);
  const procs = await listProcesses(h.deps.runner, NOW);
  const result = await stopMembers(h.deps, procs, members, 5_000);
  return { ...h, result };
}

describe('stopMembers', () => {
  it('TERM theo group khi group chỉ gồm process đã chọn, còn lại theo pid; KILL phần sống sót', async () => {
    const afterTerm = [
      '    1     0     1 ??       10-00:00:00 /sbin/launchd',
      '  601   600   600 ??             01:50 claude',
    ].join('\n');
    const gone = '    1     0     1 ??       10-00:00:00 /sbin/launchd';
    const { signals, sleeps, result } = await run([BEFORE, afterTerm, gone], [601, 610, 611]);
    expect(signals).toEqual(['SIGTERM -610', 'SIGTERM 601', 'SIGKILL 601']);
    expect(sleeps).toEqual([5_000, 200]);
    expect(result).toEqual({ matched: 3, killed: 1, remaining: 0 });
  });

  it('mọi process thoát sau TERM thì không KILL và không chờ thêm', async () => {
    const gone = '    1     0     1 ??       10-00:00:00 /sbin/launchd';
    const { signals, sleeps, result } = await run([BEFORE, gone], [601, 610, 611]);
    expect(signals).toEqual(['SIGTERM -610', 'SIGTERM 601']);
    expect(sleeps).toEqual([5_000]);
    expect(result).toEqual({ matched: 3, killed: 0, remaining: 0 });
  });

  it('pid bị cấp lại cho process khác trong lúc chờ thì không KILL nó', async () => {
    const reused = [
      '    1     0     1 ??       10-00:00:00 /sbin/launchd',
      '  611     1   611 ??             00:01 Foo',
    ].join('\n');
    const { signals, result } = await run([BEFORE, reused], [601, 610, 611]);
    expect(signals).toEqual(['SIGTERM -610', 'SIGTERM 601']);
    expect(result).toEqual({ matched: 3, killed: 0, remaining: 0 });
  });

  it('group có process mới không được chọn sau khi chờ thì KILL theo pid, không theo group', async () => {
    const afterTerm = [
      '    1     0     1 ??       10-00:00:00 /sbin/launchd',
      '  610   601   610 ??             01:00 zsh',
      '  612   610   610 ??             00:01 sleep',
    ].join('\n');
    const gone = '    1     0     1 ??       10-00:00:00 /sbin/launchd';
    const { signals, result } = await run([BEFORE, afterTerm, gone], [610, 611]);
    expect(signals).toEqual(['SIGTERM -610', 'SIGKILL 610']);
    expect(result).toEqual({ matched: 2, killed: 1, remaining: 0 });
  });

  it('còn sống sau KILL thì báo remaining', async () => {
    const stuck = [
      '    1     0     1 ??       10-00:00:00 /sbin/launchd',
      '  601   600   600 ??             01:50 claude',
    ].join('\n');
    const { result } = await run([BEFORE, stuck, stuck], [601]);
    expect(result).toEqual({ matched: 1, killed: 1, remaining: 1 });
  });

  it('process đổi group sau TERM vẫn bị KILL và được đếm đúng', async () => {
    const moved = [
      '    1     0     1 ??       10-00:00:00 /sbin/launchd',
      '  611     1   777 ??             00:50 make',
    ].join('\n');
    const { signals, result } = await run([BEFORE, moved, moved], [601, 610, 611]);
    expect(signals).toEqual(['SIGTERM -610', 'SIGTERM 601', 'SIGKILL 611']);
    expect(result).toEqual({ matched: 3, killed: 1, remaining: 1 });
  });

  it('etime không đọc được sau KILL thì vẫn tính vào remaining', async () => {
    const stuckOdd = [
      '    1     0     1 ??       10-00:00:00 /sbin/launchd',
      '  601   600   600 ??             lạ claude',
    ].join('\n');
    const afterTerm = [
      '    1     0     1 ??       10-00:00:00 /sbin/launchd',
      '  601   600   600 ??             01:50 claude',
    ].join('\n');
    const { result } = await run([BEFORE, afterTerm, stuckOdd], [601]);
    expect(result).toEqual({ matched: 1, killed: 1, remaining: 1 });
  });

  it('process không đọc được thời điểm sinh còn sống ngay sau TERM thì tính vào remaining, không KILL', async () => {
    const oddAfterTerm = [
      '    1     0     1 ??       10-00:00:00 /sbin/launchd',
      '  601   600   600 ??             lạ claude',
    ].join('\n');
    const { signals, sleeps, result } = await run([BEFORE, oddAfterTerm], [601]);
    expect(signals).toEqual(['SIGTERM 601']);
    expect(sleeps).toEqual([5_000]);
    expect(result).toEqual({ matched: 1, killed: 0, remaining: 1 });
  });

  it('không có gì để dừng thì không gửi signal, không chờ', async () => {
    const { signals, sleeps, result } = await run([BEFORE], []);
    expect(signals).toEqual([]);
    expect(sleeps).toEqual([]);
    expect(result).toEqual({ matched: 0, killed: 0, remaining: 0 });
  });

  it('không gửi signal theo group trùng group của chính mình', async () => {
    const { signals } = await run(
      [BEFORE, '    1     0     1 ??       10-00:00:00 /sbin/launchd'],
      [610, 611],
      611,
    );
    expect(signals).toEqual(['SIGTERM 610']);
  });
});
