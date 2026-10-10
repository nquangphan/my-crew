import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listProcesses, type ProcInfo } from '../src/reaper/process-table.js';
import { isAgentPrint, selectRunMembers } from '../src/reaper/run-members.js';
import { isAgentPrint as isAgentPrintFromSelect, selectTargets } from '../src/reaper/select.js';
import { FakeRunner } from './helpers/fake-runner.js';

const NOW = new Date('2026-10-10T07:00:00.000Z');
const RUN = 'b8d37c86-3edb-4634-953c-64a1a654ab41';

function fixture(name: string): { tree: string; argv: string; env: string } {
  const text = readFileSync(join(__dirname, 'fixtures', 'ps', name), 'utf8');
  const parts: Record<string, string[]> = {};
  let key = '';
  for (const line of text.split('\n')) {
    const m = /^# (tree|argv|env)$/.exec(line);
    if (m) key = m[1] as string;
    else if (key && line.trim() !== '') parts[key] = [...(parts[key] ?? []), line];
  }
  return {
    tree: parts.tree?.join('\n') ?? '',
    argv: parts.argv?.join('\n') ?? '',
    env: parts.env?.join('\n') ?? '',
  };
}

async function load(name: string): Promise<ProcInfo[]> {
  const f = fixture(name);
  const runner = new FakeRunner().on('/bin/ps', (args) => ({
    stdout: args.includes('-E') ? f.env : args.includes('pid=,command=') ? f.argv : f.tree,
  }));
  return listProcesses(runner, NOW);
}

function make(command: string, runId: string | null = RUN): ProcInfo {
  return {
    pid: 10,
    ppid: 1,
    pgid: 10,
    tty: '??',
    startedAt: 0,
    comm: 'x',
    command,
    runId,
    envReadable: true,
  };
}

describe('isAgentPrint', () => {
  it('fixture codex-exec (dựng tay): nhận codex exec có run id', async () => {
    const procs = await load('codex-exec.txt');
    const codex = procs.find((p) => p.pid === 84310) as ProcInfo;
    expect(codex.runId).toBe('b8d37c86-3edb-4634-953c-64a1a654ab41');
    expect(isAgentPrint(codex)).toBe(true);
    expect(isAgentPrint(procs.find((p) => p.pid === 84305) as ProcInfo)).toBe(false);
  });

  it('fixture opencode-run (GIẢ ĐỊNH A5, chưa đo thật): nhận opencode run có run id', async () => {
    const procs = await load('opencode-run.txt');
    const oc = procs.find((p) => p.pid === 85310) as ProcInfo;
    expect(oc.runId).toBe('c9e48d97-4edb-4634-953c-64a1a654ab42');
    expect(isAgentPrint(oc)).toBe(true);
  });

  it.each([
    ['claude --print', '/Users/u/.local/bin/claude --print --output-format stream-json', true],
    ['claude tương tác', '/Users/u/.local/bin/claude --dangerously-skip-permissions', false],
    ['codex exec qua PATH', 'codex exec --json -', true],
    ['codex --search exec (search bật)', '/Users/u/.local/bin/codex --search exec --json -', true],
    ['codex e (alias)', 'codex e --json -', true],
    ['codex login', '/Users/u/.local/bin/codex login status', false],
    ['codex app-server', '/Users/u/.local/bin/codex app-server', false],
    ['codex chỉ cờ', '/Users/u/.local/bin/codex --version', false],
    ['codex không subcommand', 'codex', false],
    ['exec không phải codex', '/bin/sh exec codex', false],
    ['tên chứa codex', '/usr/bin/codex-helper exec', false],
    ['opencode run', '/opt/homebrew/bin/opencode run --format json', true],
    ['.opencode run (shim)', '/opt/homebrew/lib/.opencode run --format json', true],
    ['opencode --print-logs run', 'opencode --print-logs run x', true],
    ['opencode models', '/opt/homebrew/bin/opencode models opencode-go', false],
    ['opencode serve', '/opt/homebrew/bin/opencode serve', false],
    ['opencode không subcommand', 'opencode', false],
  ])('%s', (_name, command, expected) => {
    expect(isAgentPrint(make(command))).toBe(expected);
  });

  it('không có runId thì không phải agent run (kể cả codex/opencode của owner)', () => {
    expect(isAgentPrint(make('codex exec --json -', null))).toBe(false);
    expect(isAgentPrint(make('opencode run x', null))).toBe(false);
    expect(isAgentPrint(make('claude --print', null))).toBe(false);
  });

  it('select.ts xuất lại đúng hàm', () => {
    expect(isAgentPrintFromSelect).toBe(isAgentPrint);
  });
});

describe('bộ dọn với run codex/opencode', () => {
  it('selectTargets chọn opencode run mồ côi quá hạn, bỏ codex tương tác', async () => {
    const procs = await load('opencode-run.txt');
    const list = [
      ...procs,
      { ...make('codex'), pid: 99, ppid: 1, runId: null },
      { ...make('/opt/homebrew/bin/opencode models'), pid: 98, runId: null },
    ];
    const { targets } = selectTargets(list, { orphanSince: {} }, NOW, 0, 1);
    expect(targets.map((t) => t.pid)).toEqual([85310]);
  });

  it('selectTargets chọn codex exec mồ côi', async () => {
    const { targets } = selectTargets(await load('codex-exec.txt'), { orphanSince: {} }, NOW, 0, 1);
    expect(targets.map((t) => [t.pid, t.runId])).toEqual([[84310, RUN]]);
  });

  it('selectRunMembers nhận cả con cháu của codex exec theo run id', async () => {
    const procs = await load('codex-exec.txt');
    const child = {
      ...make('/usr/bin/sandbox-exec -p x /bin/zsh -c ls', null),
      pid: 84320,
      ppid: 84310,
      pgid: 84320,
      envReadable: false,
    };
    const spec = { runId: RUN, root: null, started: null, nextStarted: null, pgid: null, bootTime: null };
    expect(selectRunMembers([...procs, child], spec, 1, new Map())).toEqual([84310, 84320]);
    const other = { ...spec, runId: 'khac' };
    expect(selectRunMembers([...procs, child], other, 1, new Map())).toEqual([]);
  });
});
