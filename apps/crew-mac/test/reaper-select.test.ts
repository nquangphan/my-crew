import { describe, expect, it } from 'vitest';
import { listProcesses, type ProcInfo } from '../src/reaper/process-table.js';
import { isClaudePrint, isOrphaned, selectTargets } from '../src/reaper/select.js';
import { FakeRunner } from './helpers/fake-runner.js';

// Cột: pid ppid pgid tty etime comm.
const TREE = [
  '    1     0     1 ??       10-00:00:00 /sbin/launchd',
  '17611     1 17611 ??          01:00:00 sshd: /usr/sbin/sshd -D -f /Users/owner/.crew-mac/sshd/sshd_config [listener]',
  '71433 17611 71433 ??             05:00 sshd-session: owner [priv]',
  '71435 71433 71433 ??             05:00 sshd-session: owner@notty',
  '71436 71435 71436 ??             04:59 zsh',
  '71440 71436 71436 ??             04:58 claude',
  '80000     1 80000 ??             04:00 zsh',
  '80001 80000 80000 ??             03:59 claude',
  '80002 80001 80000 ??             03:00 git',
  '90000 57355 90000 ttys003       02:00 claude',
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

const NOW = new Date('2026-10-06T07:05:00.000Z');

function runnerFor(tree: string, argv: string, env: string) {
  return new FakeRunner().on('/bin/ps', (args) => ({
    stdout: args.includes('-E') ? env : args.includes('pid=,command=') ? argv : tree,
  }));
}

async function procs(tree = TREE, argv = ARGV, env = ENV): Promise<ProcInfo[]> {
  return listProcesses(runnerFor(tree, argv, env), NOW);
}

const byPid = (list: ProcInfo[]) => new Map(list.map((p) => [p.pid, p]));
const at = (iso: string) => new Date(iso);

describe('chọn claude mồ côi của run', () => {
  it('chỉ nhận claude --print có run id', async () => {
    const map = byPid(await procs());
    expect(isClaudePrint(map.get(71440) as ProcInfo)).toBe(true);
    expect(isClaudePrint(map.get(90000) as ProcInfo)).toBe(false);
  });

  it('còn sshd-session trong chuỗi tổ tiên thì không mồ côi, kể cả khi cha trực tiếp sống', async () => {
    const map = byPid(await procs());
    expect(isOrphaned(map.get(71440) as ProcInfo, map)).toBe(false);
    expect(isOrphaned(map.get(80001) as ProcInfo, map)).toBe(true);
  });

  it('lần đầu thấy mồ côi thì chỉ ghi lại thời điểm', async () => {
    const { targets, nextState } = selectTargets(
      await procs(),
      { orphanSince: {} },
      at('2026-10-06T07:00:00Z'),
      60_000,
      999,
    );
    expect(targets).toEqual([]);
    expect(nextState).toEqual({ orphanSince: { '80001:run-dead': '2026-10-06T07:00:00.000Z' } });
  });

  it('chưa đủ 60 giây thì chưa chọn', async () => {
    const state = { orphanSince: { '80001:run-dead': '2026-10-06T07:00:00.000Z' } };
    const { targets } = selectTargets(await procs(), state, at('2026-10-06T07:00:59Z'), 60_000, 999);
    expect(targets).toEqual([]);
  });

  it('đủ 60 giây thì chọn claude của run', async () => {
    const state = { orphanSince: { '80001:run-dead': '2026-10-06T07:00:00.000Z' } };
    const { targets } = selectTargets(await procs(), state, at('2026-10-06T07:01:00Z'), 60_000, 999);
    expect(targets).toEqual([{ pid: 80001, runId: 'run-dead', orphanSince: '2026-10-06T07:00:00.000Z' }]);
  });

  it('không bao giờ chọn phiên claude tương tác của owner', async () => {
    const list = (await procs()).map((p) => (p.pid === 90000 ? { ...p, ppid: 1 } : p));
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

  it('không chọn chính process reaper', async () => {
    const { targets } = selectTargets(
      await procs(),
      { orphanSince: {} },
      at('2026-10-06T07:00:00Z'),
      0,
      80001,
    );
    expect(targets).toEqual([]);
  });

  it('claude -p của owner chạy từ Terminal, prompt có chữ PAPERCLIP_RUN_ID= nhưng env không có: không chọn', async () => {
    const argvLine = '95000 claude -p giải thích vì sao PAPERCLIP_RUN_ID=abc-123 bị lỗi';
    const list = await procs(
      `${TREE}\n95000     1 95000 ??             00:10 claude`,
      `${ARGV}\n${argvLine}`,
      `${ENV}\n${argvLine} HOME=/Users/owner TERM_PROGRAM=Apple_Terminal`,
    );
    const { targets } = selectTargets(list, { orphanSince: {} }, at('2026-10-06T07:00:00Z'), 0, 999);
    expect(targets.map((t) => t.pid)).toEqual([80001]);
  });

  it('bỏ entry state của process đã hết mồ côi hoặc đã chết', async () => {
    const state = { orphanSince: { '12345:run-old': '2026-10-06T06:00:00.000Z' } };
    const { nextState } = selectTargets(await procs(), state, at('2026-10-06T07:00:00Z'), 60_000, 999);
    expect(nextState.orphanSince['12345:run-old']).toBeUndefined();
  });
});
