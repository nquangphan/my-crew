import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MacContext } from '../src/context.js';
import { createRunner } from '../src/system.js';
import { installSuperpowersPin } from '../src/workflows/install.js';
import {
  classifyOrigin,
  DIRTY_REASON,
  type DiscoveredSource,
  discoverSources,
  IGNORED_REASON,
  UNTRACKED_REASON,
} from '../src/workflows/inventory.js';
import { fakeMac } from './helpers/fake-mac.js';

const root = '/Users/a/crew-agents/exec';
const pinDir = '/Users/a/.crew/workflows/superpowers/6.4.1-5bf4e7801107';

describe('classifyOrigin', () => {
  it('phân loại theo vị trí và git track', () => {
    expect(classifyOrigin({ path: `${pinDir}/skills/brainstorming`, root, pinDir, tracked: false })).toBe(
      'pinned',
    );
    expect(
      classifyOrigin({
        path: `${root}/.paperclip-runtime/claude/skills/paperclip`,
        root,
        pinDir,
        tracked: false,
      }),
    ).toBe('paperclip');
    expect(classifyOrigin({ path: `${root}/.claude/skills/x`, root, pinDir, tracked: true })).toBe('project');
    expect(classifyOrigin({ path: `${root}/.claude/skills/x`, root, pinDir, tracked: false })).toBe(
      'blocked',
    );
    expect(classifyOrigin({ path: '/Users/a/.claude/skills/tro-ly', root, pinDir, tracked: false })).toBe(
      'blocked',
    );
    expect(
      classifyOrigin({ path: '/Users/a/crew-agents/exec2/.claude/skills/x', root, pinDir, tracked: true }),
    ).toBe('blocked');
  });
});

function git(cwd: string, ...args: string[]): void {
  execFileSync('/usr/bin/git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
    cwd,
    stdio: 'ignore',
  });
}

/** Worktree git thật: `.claude/skills/tracked` đã commit. */
function worktree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'crew-inv-'));
  git(dir, 'init', '-q');
  mkdirSync(join(dir, '.claude', 'skills', 'tracked'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'skills', 'tracked', 'SKILL.md'), '---\nname: tracked\n---\n');
  git(dir, 'add', '.claude');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

function realGitCtx(): { ctx: MacContext; home: string } {
  const mac = fakeMac();
  return { ctx: { ...mac.ctx, runner: createRunner() }, home: mac.home };
}

describe('discoverSources', () => {
  const at = (sources: DiscoveredSource[], path: string) => sources.find((s) => s.path === path);

  it('skill đã commit là project; skill, agent chưa track và settings.local.json bật hook là blocked', async () => {
    const { ctx } = realGitCtx();
    const dir = worktree();
    mkdirSync(join(dir, '.claude', 'skills', 'stray'));
    writeFileSync(join(dir, '.claude', 'skills', 'stray', 'SKILL.md'), 'x');
    mkdirSync(join(dir, '.claude', 'agents'));
    writeFileSync(join(dir, '.claude', 'agents', 'dropped.md'), 'x');
    writeFileSync(join(dir, '.claude', 'settings.local.json'), '{"hooks":{}}');
    const sources = await discoverSources(ctx, dir);
    expect(at(sources, join(dir, '.claude', 'skills', 'tracked'))).toMatchObject({
      kind: 'skill',
      origin: 'project',
    });
    expect(at(sources, join(dir, '.claude', 'skills', 'stray'))).toMatchObject({
      kind: 'skill',
      origin: 'blocked',
      reason: UNTRACKED_REASON,
    });
    expect(at(sources, join(dir, '.claude', 'agents', 'dropped.md'))).toMatchObject({
      kind: 'agent',
      origin: 'blocked',
    });
    expect(at(sources, join(dir, '.claude', 'settings.local.json'))).toMatchObject({
      kind: 'settings',
      origin: 'blocked',
    });
  });

  it('rác hệ điều hành, __pycache__ và file không phải nguồn nạp trong skill đã commit không chặn', async () => {
    const { ctx } = realGitCtx();
    const dir = worktree();
    writeFileSync(join(dir, '.gitignore'), '__pycache__/\n*.pyc\n.DS_Store\n');
    git(dir, 'add', '.gitignore');
    git(dir, 'commit', '-q', '-m', 'ignore');
    const skill = join(dir, '.claude', 'skills', 'tracked');
    mkdirSync(join(skill, 'scripts', '__pycache__'), { recursive: true });
    writeFileSync(join(skill, 'scripts', '__pycache__', 'x.cpython-312.pyc'), 'bytecode');
    writeFileSync(join(skill, '.DS_Store'), 'finder');
    writeFileSync(join(skill, 'output.txt'), 'kết quả tạm');
    writeFileSync(join(dir, '.claude', 'skills', '.DS_Store'), 'finder');
    writeFileSync(join(dir, '.claude', '.DS_Store'), 'finder');
    const sources = await discoverSources(ctx, dir);
    expect(sources).toEqual([{ path: skill, kind: 'skill', origin: 'project' }]);
  });

  it('SKILL.md bị ignore hoặc chưa track thì chặn, kể cả trong thư mục skill đã commit', async () => {
    const { ctx } = realGitCtx();
    const dir = worktree();
    writeFileSync(join(dir, '.gitignore'), '.claude/skills/hidden/\n');
    git(dir, 'add', '.gitignore');
    git(dir, 'commit', '-q', '-m', 'ignore');
    mkdirSync(join(dir, '.claude', 'skills', 'hidden'));
    writeFileSync(join(dir, '.claude', 'skills', 'hidden', 'SKILL.md'), 'x');
    mkdirSync(join(dir, '.claude', 'skills', 'nested', 'sub'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'skills', 'nested', 'README.md'), 'đã commit');
    git(dir, 'add', '.claude/skills/nested/README.md');
    git(dir, 'commit', '-q', '-m', 'nested');
    writeFileSync(join(dir, '.claude', 'skills', 'nested', 'SKILL.md'), 'thả vào thư mục đã commit');
    const sources = await discoverSources(ctx, dir);
    expect(at(sources, join(dir, '.claude', 'skills', 'hidden'))).toMatchObject({
      origin: 'blocked',
      reason: IGNORED_REASON,
    });
    expect(at(sources, join(dir, '.claude', 'skills', 'nested'))).toMatchObject({
      origin: 'blocked',
      reason: UNTRACKED_REASON,
    });
  });

  it('SKILL.md và agent đã track mà sửa dở chỉ cảnh báo; settings.json và script hook sửa dở thì chặn', async () => {
    const { ctx } = realGitCtx();
    const dir = worktree();
    mkdirSync(join(dir, '.claude', 'agents'));
    writeFileSync(join(dir, '.claude', 'agents', 'a.md'), 'agent');
    mkdirSync(join(dir, '.claude', 'hooks'));
    writeFileSync(join(dir, '.claude', 'hooks', 'pre.cjs'), 'hook');
    writeFileSync(join(dir, '.claude', 'settings.json'), '{}');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'more');
    writeFileSync(join(dir, '.claude', 'skills', 'tracked', 'SKILL.md'), '---\nname: tracked\n---\nsửa dở\n');
    writeFileSync(join(dir, '.claude', 'agents', 'a.md'), 'agent sửa dở');
    writeFileSync(join(dir, '.claude', 'hooks', 'pre.cjs'), 'hook sửa dở');
    writeFileSync(join(dir, '.claude', 'settings.json'), '{"hooks":{}}');
    const sources = await discoverSources(ctx, dir);
    const skill = at(sources, join(dir, '.claude', 'skills', 'tracked'));
    expect(skill).toMatchObject({ origin: 'project', warning: DIRTY_REASON });
    expect(skill?.fix).toContain(`git -C ${dir} diff HEAD -- .claude/skills/tracked/SKILL.md`);
    expect(at(sources, join(dir, '.claude', 'agents', 'a.md'))).toMatchObject({
      origin: 'project',
      warning: DIRTY_REASON,
    });
    for (const rel of ['.claude/hooks/pre.cjs', '.claude/settings.json']) {
      const s = at(sources, join(dir, ...rel.split('/')));
      expect(s).toMatchObject({ origin: 'blocked', reason: DIRTY_REASON });
      expect(s?.fix).toContain(`git -C ${dir} diff HEAD -- ${rel}`);
      expect(s?.fix).toContain(`git -C ${dir} checkout HEAD -- ${rel}`);
    }
  });

  it('nguồn chưa track vẫn chặn, kèm cách xử lý', async () => {
    const { ctx } = realGitCtx();
    const dir = worktree();
    mkdirSync(join(dir, '.claude', 'agents'));
    writeFileSync(join(dir, '.claude', 'agents', 'moi.md'), 'x');
    const s = at(await discoverSources(ctx, dir), join(dir, '.claude', 'agents', 'moi.md'));
    expect(s).toMatchObject({ origin: 'blocked', reason: UNTRACKED_REASON });
    expect(s?.fix).toContain(`git -C ${dir} add -- .claude/agents/moi.md`);
  });

  it('đường dẫn worktree khác hoa thường với đường dẫn git trả (APFS) vẫn khớp', async () => {
    const { ctx } = realGitCtx();
    const dir = worktree();
    const upper = dir.replace(/crew-inv-([^/]*)$/, (_m, rest: string) => `CREW-INV-${rest}`);
    if (!existsSync(upper)) return; // ổ phân biệt hoa thường: không áp dụng
    const sources = await discoverSources(ctx, join(upper, 'packages', '..'));
    expect(sources).toEqual([
      { path: join(upper, '.claude', 'skills', 'tracked'), kind: 'skill', origin: 'project' },
    ]);
  });

  it('worktree là thư mục con của repo: đường dẫn git tính từ gốc repo vẫn khớp', async () => {
    const { ctx } = realGitCtx();
    const repo = mkdtempSync(join(tmpdir(), 'crew-inv-repo-'));
    git(repo, 'init', '-q');
    const sub = join(repo, 'packages', 'app');
    mkdirSync(join(sub, '.claude', 'skills', 'x'), { recursive: true });
    writeFileSync(join(sub, '.claude', 'skills', 'x', 'SKILL.md'), 'x');
    writeFileSync(join(sub, '.claude', 'settings.json'), '{}');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'init');
    const clean = await discoverSources(ctx, sub);
    expect(clean.filter((s) => s.origin === 'blocked')).toEqual([]);
    expect(at(clean, join(sub, '.claude', 'skills', 'x'))?.origin).toBe('project');
    writeFileSync(join(sub, '.claude', 'settings.json'), '{"hooks":{}}');
    expect(at(await discoverSources(ctx, sub), join(sub, '.claude', 'settings.json'))).toMatchObject({
      origin: 'blocked',
      reason: DIRTY_REASON,
    });
  });

  it('symlink đã track trỏ ra ngoài worktree thì chặn; trỏ trong worktree thì cho qua', async () => {
    const { ctx } = realGitCtx();
    const dir = worktree();
    const outside = mkdtempSync(join(tmpdir(), 'crew-outside-'));
    writeFileSync(join(outside, 'SKILL.md'), 'skill cá nhân');
    symlinkSync(outside, join(dir, '.claude', 'skills', 'ca-nhan'));
    mkdirSync(join(dir, 'shared-skill'));
    writeFileSync(join(dir, 'shared-skill', 'SKILL.md'), 'trong repo');
    symlinkSync('../../shared-skill', join(dir, '.claude', 'skills', 'noi-bo'));
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'links');
    const sources = await discoverSources(ctx, dir);
    expect(at(sources, join(dir, '.claude', 'skills', 'ca-nhan'))).toMatchObject({
      origin: 'blocked',
      reason: expect.stringContaining('symlink trỏ ra ngoài worktree'),
    });
    expect(at(sources, join(dir, '.claude', 'skills', 'noi-bo'))?.origin).toBe('project');
  });

  it('hook và .mcp.json chưa track thì chặn, đã commit thì là project', async () => {
    const { ctx } = realGitCtx();
    const dir = worktree();
    mkdirSync(join(dir, '.claude', 'hooks'));
    writeFileSync(join(dir, '.claude', 'hooks', 'pre.sh'), 'echo');
    writeFileSync(join(dir, '.mcp.json'), '{"mcpServers":{}}');
    writeFileSync(join(dir, '.gitignore'), '.claude/hooks/.logs/\n');
    mkdirSync(join(dir, '.claude', 'hooks', '.logs'));
    writeFileSync(join(dir, '.claude', 'hooks', '.logs', 'hook-log.jsonl'), '{}');
    writeFileSync(join(dir, '.claude', 'hooks', 'notes.txt'), 'không phải script');
    const before = await discoverSources(ctx, dir);
    expect(before.some((s) => s.path.includes('.logs') || s.path.endsWith('notes.txt'))).toBe(false);
    expect(at(before, join(dir, '.claude', 'hooks', 'pre.sh'))).toMatchObject({
      kind: 'hook',
      origin: 'blocked',
    });
    expect(at(before, join(dir, '.mcp.json'))).toMatchObject({ kind: 'mcp', origin: 'blocked' });
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'hooks');
    const after = await discoverSources(ctx, dir);
    expect(after.filter((s) => s.origin === 'blocked')).toEqual([]);
    expect(at(after, join(dir, '.mcp.json'))?.origin).toBe('project');
  });

  it('settings.local.json không bật plugin hay hook thì không tính; worktree sạch không có blocked', async () => {
    const { ctx } = realGitCtx();
    const dir = worktree();
    writeFileSync(join(dir, '.gitignore'), '.claude/settings.local.json\n');
    git(dir, 'add', '.gitignore');
    git(dir, 'commit', '-q', '-m', 'ignore');
    writeFileSync(join(dir, '.claude', 'settings.local.json'), '{"permissions":{"allow":[]}}');
    const sources = await discoverSources(ctx, dir);
    expect(sources.filter((s) => s.origin === 'blocked')).toEqual([]);
  });

  it('superpowers bật trong repo luôn là pinned (run chỉ nạp bản --plugin-dir), không đọc cài đặt của owner; plugin khác là project', async () => {
    const { ctx, home } = realGitCtx();
    const dir = worktree();
    writeFileSync(
      join(dir, '.claude', 'settings.json'),
      JSON.stringify({
        enabledPlugins: {
          'superpowers@claude-plugins-official': true,
          'context7@claude-plugins-official': true,
          'off@x': false,
        },
      }),
    );
    git(dir, 'add', '.claude/settings.json');
    git(dir, 'commit', '-q', '-m', 'settings');
    const same = await discoverSources(ctx, dir);
    expect(same.find((s) => s.path.endsWith('#superpowers@claude-plugins-official'))).toMatchObject({
      kind: 'plugin',
      origin: 'pinned',
    });
    expect(same.find((s) => s.path.endsWith('#context7@claude-plugins-official'))?.origin).toBe('project');
    expect(same.some((s) => s.path.endsWith('#off@x'))).toBe(false);

    rmSync(join(home, '.claude', 'plugins'), { recursive: true });
    const ownerGone = await discoverSources(ctx, dir);
    expect(ownerGone.find((s) => s.path.endsWith('#superpowers@claude-plugins-official'))?.origin).toBe(
      'pinned',
    );
  });

  it('settings.json không được track thì blocked', async () => {
    const { ctx } = realGitCtx();
    const dir = worktree();
    writeFileSync(join(dir, '.claude', 'settings.json'), '{"hooks":{}}');
    const sources = await discoverSources(ctx, dir);
    expect(at(sources, join(dir, '.claude', 'settings.json'))).toMatchObject({
      origin: 'blocked',
      reason: UNTRACKED_REASON,
    });
  });

  it('git lỗi hoặc quá hạn thì chặn với lý do "không kiểm được", không nói sai là chưa track', async () => {
    const dir = worktree();
    for (const result of [
      { code: 128, stderr: 'fatal: not a git repository' },
      { code: 137, timedOut: true },
    ]) {
      const mac = fakeMac();
      mac.runner.on('/usr/bin/git', () => result);
      const sources = await discoverSources(mac.ctx, dir);
      expect(at(sources, join(dir, '.claude', 'skills', 'tracked'))).toMatchObject({
        origin: 'blocked',
        reason: expect.stringContaining('không kiểm được git'),
      });
      expect(sources.every((s) => !s.reason?.includes(UNTRACKED_REASON))).toBe(true);
    }
  });

  it('chỉ gọi git cố định số lần cho cả cây, không theo số nguồn', async () => {
    const dir = worktree();
    for (const name of ['a', 'b', 'c']) {
      mkdirSync(join(dir, '.claude', 'skills', name));
      writeFileSync(join(dir, '.claude', 'skills', name, 'SKILL.md'), name);
    }
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'more');
    const mac = fakeMac();
    const real = createRunner();
    let calls = 0;
    const ctx: MacContext = {
      ...mac.ctx,
      runner: {
        run: (command, args, options) => {
          calls++;
          return real.run(command, args, options);
        },
      },
    };
    const sources = await discoverSources(ctx, dir);
    expect(sources.filter((s) => s.origin === 'project')).toHaveLength(4);
    expect(calls).toBeLessThanOrEqual(3);
  });

  it('thư mục ghim không có trong worktree thì không lọt vào danh sách', async () => {
    const { ctx } = realGitCtx();
    installSuperpowersPin(ctx);
    const sources = await discoverSources(ctx, worktree());
    expect(sources.map((s) => s.origin)).toEqual(['project']);
  });
});
