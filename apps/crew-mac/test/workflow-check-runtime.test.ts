import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { workflowCheckRuntime } from '../src/commands/workflow-check.js';
import type { MacContext } from '../src/context.js';
import { createRunner } from '../src/system.js';
import { installSuperpowersPin } from '../src/workflows/install.js';
import { lastRunWorkflow } from '../src/workflows/inventory.js';
import { findRuntimeSources, trackedRuntimeFiles } from '../src/workflows/runtime-sources.js';
import { fakeMac } from './helpers/fake-mac.js';

function git(cwd: string, ...args: string[]): void {
  execFileSync('/usr/bin/git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
    cwd,
    stdio: 'ignore',
  });
}

function write(root: string, rel: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), 'x\n');
}

/** Repo git thật: `tracked` được commit, `untracked` chỉ nằm trên đĩa. */
function tmpRepo(files: { tracked?: string[]; untracked?: string[] } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'crew-wfr-'));
  git(dir, 'init', '-q');
  write(dir, 'README.md');
  for (const f of files.tracked ?? []) write(dir, f);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  for (const f of files.untracked ?? []) write(dir, f);
  return dir;
}

function installedMac(): { ctx: MacContext; home: string; pinDir: string } {
  const mac = fakeMac();
  const ctx = { ...mac.ctx, runner: createRunner() };
  return { ctx, home: mac.home, pinDir: installSuperpowersPin(ctx).dir };
}

const paths = (r: { path: string }[]) => r.map((f) => f.path).sort();

describe('findRuntimeSources', () => {
  it('chặn cấu hình runtime trong worktree không được git theo dõi, theo đúng runtime', () => {
    const root = tmpRepo({
      untracked: ['.codex/config.toml', '.opencode/agent/x.md', 'opencode.json', 'opencode.jsonc'],
    });
    const opencode = findRuntimeSources({ root, runtime: 'opencode_local', tracked: new Set() });
    expect(paths(opencode)).toEqual(['.opencode/agent/x.md', 'opencode.json', 'opencode.jsonc']);
    expect(opencode.every((f) => f.reason === 'runtime-config')).toBe(true);
    expect(findRuntimeSources({ root, runtime: 'codex_local', tracked: new Set() })).toEqual([
      { path: '.codex/config.toml', reason: 'runtime-config' },
    ]);
  });

  it('file được git theo dõi thì không chặn', () => {
    const root = tmpRepo({ tracked: ['opencode.json', '.codex/config.toml'] });
    const tracked = trackedRuntimeFiles(root);
    expect([...tracked].sort()).toEqual(['.codex/config.toml', 'opencode.json']);
    expect(findRuntimeSources({ root, runtime: 'opencode_local', tracked })).toEqual([]);
    expect(findRuntimeSources({ root, runtime: 'codex_local', tracked })).toEqual([]);
  });

  it('file đã theo dõi mà có file lạ cạnh nó thì chỉ chặn file lạ; symlink cũng bị chặn', () => {
    const root = tmpRepo({ tracked: ['.opencode/agent/a.md'], untracked: ['.opencode/agent/b.md'] });
    symlinkSync('/etc/hosts', join(root, '.opencode', 'link.md'));
    const r = findRuntimeSources({ root, runtime: 'opencode_local', tracked: trackedRuntimeFiles(root) });
    expect(paths(r)).toEqual(['.opencode/agent/b.md', '.opencode/link.md']);
  });

  it('thư mục .codex/.opencode lồng sâu hơn gốc worktree không tính', () => {
    const root = tmpRepo({ untracked: ['pkg/.codex/config.toml', 'pkg/opencode.json'] });
    expect(findRuntimeSources({ root, runtime: 'codex_local', tracked: new Set() })).toEqual([]);
    expect(findRuntimeSources({ root, runtime: 'opencode_local', tracked: new Set() })).toEqual([]);
  });

  it('không phải repo git thì coi như không file nào được theo dõi', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crew-wfr-nogit-'));
    expect(trackedRuntimeFiles(dir).size).toBe(0);
  });
});

describe('workflowCheckRuntime', () => {
  it('sạch, CREW_SUPERPOWERS_DIR đúng bản ghim thì ok và ghi worktree thuộc superpowers', async () => {
    const { ctx, home, pinDir } = installedMac();
    const root = tmpRepo({ tracked: ['opencode.json'] });
    const r = await workflowCheckRuntime(ctx, { root, runtime: 'opencode_local', superpowersDir: pinDir });
    expect(r).toEqual({ ok: true, lines: ['crew-workflow ok runtime=opencode_local superpowers=9.9.9'] });
    expect(lastRunWorkflow(home, root)).toBe('superpowers');
  });

  it('CREW_SUPERPOWERS_DIR lệch bản ghim thì chặn với pin-mismatch', async () => {
    const { ctx } = installedMac();
    const other = mkdtempSync(join(tmpdir(), 'crew-wfr-sp-'));
    writeFileSync(join(other, 'x.md'), 'khac\n');
    const r = await workflowCheckRuntime(ctx, {
      root: tmpRepo(),
      runtime: 'codex_local',
      superpowersDir: other,
    });
    expect(r.ok).toBe(false);
    expect(r.lines[0]).toMatch(/^crew-workflow blocked: CREW_SUPERPOWERS_DIR/);
    expect(r.lines[0]).toContain('pin-mismatch');
  });

  it('thiếu CREW_SUPERPOWERS_DIR hoặc thư mục không có thì chặn với pin-missing', async () => {
    const { ctx, home } = installedMac();
    for (const superpowersDir of [undefined, '', join(home, 'khong-co')]) {
      const r = await workflowCheckRuntime(ctx, { root: tmpRepo(), runtime: 'codex_local', superpowersDir });
      expect(r.ok).toBe(false);
      expect(r.lines[0]).toMatch(/^crew-workflow blocked: CREW_SUPERPOWERS_DIR .*pin-missing/);
    }
  });

  it('gộp mọi lý do chặn: pin và từng file cấu hình runtime', async () => {
    const { ctx } = installedMac();
    const root = tmpRepo({ untracked: ['.codex/config.toml', '.codex/rules/a.rules'] });
    const r = await workflowCheckRuntime(ctx, { root, runtime: 'codex_local', superpowersDir: undefined });
    expect(r.ok).toBe(false);
    expect(r.lines).toHaveLength(3);
    expect(r.lines.slice(1)).toEqual([
      'crew-workflow blocked: .codex/config.toml (runtime-config: cấu hình codex_local trong worktree mà git không theo dõi)',
      'crew-workflow blocked: .codex/rules/a.rules (runtime-config: cấu hình codex_local trong worktree mà git không theo dõi)',
    ]);
  });
});

describe('CLI workflow-check --runtime', () => {
  function io(ctx: MacContext, env: NodeJS.ProcessEnv) {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env, context: ctx },
    };
  }

  it('sạch thì 0, bị chặn thì 78, --runtime lạ hoặc đi cùng --plugin-dir thì 2', async () => {
    const { ctx, pinDir } = installedMac();
    const env = { CREW_SUPERPOWERS_DIR: pinDir };
    const root = tmpRepo();
    const ok = io(ctx, env);
    expect(await main(['workflow-check', '--runtime', 'codex_local', '--root', root], ok.io)).toBe(0);
    expect(ok.out).toEqual(['crew-workflow ok runtime=codex_local superpowers=9.9.9']);

    write(root, 'opencode.json');
    const blocked = io(ctx, env);
    expect(await main(['workflow-check', '--runtime', 'opencode_local', '--root', root], blocked.io)).toBe(
      78,
    );
    expect(blocked.err.join('\n')).toContain('opencode.json');
    // Codex không đọc opencode.json.
    expect(await main(['workflow-check', '--runtime', 'codex_local', '--root', root], io(ctx, env).io)).toBe(
      0,
    );

    const noEnv = io(ctx, {});
    expect(await main(['workflow-check', '--runtime', 'codex_local', '--root', root], noEnv.io)).toBe(78);

    for (const args of [
      ['--runtime', 'claude_local', '--root', root],
      ['--runtime', 'x', '--root', root],
      ['--runtime', 'codex_local', '--root', 'rel'],
      ['--runtime', 'codex_local', '--root', root, '--plugin-dir', pinDir],
    ]) {
      expect(await main(['workflow-check', ...args], io(ctx, env).io)).toBe(2);
    }
  });
});
