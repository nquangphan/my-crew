import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MacContext } from '../src/context.js';
import { createRunner } from '../src/system.js';
import { installSuperpowersPin } from '../src/workflows/install.js';
import {
  BMAD_PERSONAL_REASON,
  BMAD_SCRIPT_MISMATCH_REASON,
  CROSS_WORKFLOW_REASON,
  classifyOrigin,
  compareBmadScripts,
  DIRTY_REASON,
  type DiscoveredSource,
  discoverSources,
  IGNORED_REASON,
  PARALLEL_PLUGIN_REASON,
  UNTRACKED_REASON,
} from '../src/workflows/inventory.js';
import { pinDir as workflowPinDir } from '../src/workflows/pin.js';
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
    expect(skill?.fix).toContain(`git -C '${dir}' diff HEAD -- '.claude/skills/tracked/SKILL.md'`);
    expect(at(sources, join(dir, '.claude', 'agents', 'a.md'))).toMatchObject({
      origin: 'project',
      warning: DIRTY_REASON,
    });
    for (const rel of ['.claude/hooks/pre.cjs', '.claude/settings.json']) {
      const s = at(sources, join(dir, ...rel.split('/')));
      expect(s).toMatchObject({ origin: 'blocked', reason: DIRTY_REASON });
      expect(s?.fix).toContain(`git -C '${dir}' diff HEAD -- '${rel}'`);
      expect(s?.fix).toContain(`git -C '${dir}' checkout HEAD -- '${rel}'`);
    }
  });

  it('lệnh xử lý quote đường dẫn có dấu cách và nháy đơn, chạy nguyên văn được', async () => {
    const { ctx } = realGitCtx();
    const base = mkdtempSync(join(tmpdir(), "crew inv it's-"));
    const dir = join(base, 'work tree');
    mkdirSync(join(dir, '.claude', 'skills', 'my skill'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'skills', 'my skill', 'SKILL.md'), 'x');
    writeFileSync(join(dir, '.claude', 'settings.json'), '{}');
    git(dir, 'init', '-q');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'init');
    writeFileSync(join(dir, '.claude', 'settings.json'), '{"hooks":{}}');
    const s = at(await discoverSources(ctx, dir), join(dir, '.claude', 'settings.json'));
    const quotedRoot = `'${dir.replaceAll("'", "'\\''")}'`;
    expect(s?.fix).toContain(`git -C ${quotedRoot} checkout HEAD -- '.claude/settings.json'`);
    const undo = /bỏ: (git -C .+? checkout HEAD -- '[^']*')/.exec(s?.fix ?? '')?.[1] as string;
    execFileSync('/bin/sh', ['-c', undo]);
    expect(at(await discoverSources(ctx, dir), join(dir, '.claude', 'settings.json'))).toBeUndefined();
    writeFileSync(join(dir, '.claude', 'skills', 'my skill', 'SKILL.md'), 'sửa dở');
    const skill = at(await discoverSources(ctx, dir), join(dir, '.claude', 'skills', 'my skill'));
    expect(skill?.fix).toContain(`diff HEAD -- '.claude/skills/my skill/SKILL.md'`);
  });

  it('nguồn chưa track vẫn chặn, kèm cách xử lý', async () => {
    const { ctx } = realGitCtx();
    const dir = worktree();
    mkdirSync(join(dir, '.claude', 'agents'));
    writeFileSync(join(dir, '.claude', 'agents', 'moi.md'), 'x');
    const s = at(await discoverSources(ctx, dir), join(dir, '.claude', 'agents', 'moi.md'));
    expect(s).toMatchObject({ origin: 'blocked', reason: UNTRACKED_REASON });
    expect(s?.fix).toContain(`git -C '${dir}' add -- '.claude/agents/moi.md'`);
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

describe('discoverSources theo workflow của run', () => {
  /** Repo git thật đã có một commit (README) để `git status` có HEAD. */
  function repo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'crew-inv-wf-'));
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'README.md'), 'x\n');
    git(dir, 'add', 'README.md');
    git(dir, 'commit', '-q', '-m', 'init');
    return dir;
  }

  function put(dir: string, rel: string, content: string | Buffer): void {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }

  function commit(dir: string, ...rels: string[]): void {
    git(dir, 'add', '-f', '--', ...rels);
    git(dir, 'commit', '-q', '-m', 'c');
  }

  /** Chép `_bmad/scripts` từ bản ghim BMAD giả (như `setup.py` dựng) vào repo. */
  function copyPinScripts(ctx: MacContext, dir: string): void {
    cpSync(
      join(workflowPinDir(ctx.home, ctx.bmadPin), 'skills', 'bmad', 'scripts'),
      join(dir, '_bmad', 'scripts'),
      {
        recursive: true,
      },
    );
  }

  const blockedOf = (sources: DiscoveredSource[]) => sources.filter((s) => s.origin === 'blocked');

  it('run BMAD: repo bật superpowers trong enabledPlugins thì chặn nạp chéo', async () => {
    const { ctx } = realGitCtx();
    const dir = repo();
    put(
      dir,
      '.claude/settings.json',
      JSON.stringify({ enabledPlugins: { 'superpowers@claude-plugins-official': true } }),
    );
    commit(dir, '.claude/settings.json');
    const s = await discoverSources(ctx, dir, ctx.bmadPin);
    expect(s).toContainEqual(
      expect.objectContaining({
        path: join(dir, '.claude', 'settings.json#superpowers@claude-plugins-official'),
        kind: 'plugin',
        origin: 'blocked',
        reason: 'bật workflow superpowers khác với workflow của run (nạp chéo)',
        fix: 'Bỏ "superpowers@claude-plugins-official" khỏi enabledPlugins của .claude/settings.json (commit), hoặc giao issue cho agent của workflow superpowers.',
      }),
    );
    expect(s.find((x) => x.origin === 'blocked')?.reason).toContain(CROSS_WORKFLOW_REASON);
  });

  it('run Superpowers: repo bật bmad-method@bmad thì chặn; superpowers vẫn pinned', async () => {
    const { ctx } = realGitCtx();
    const dir = repo();
    put(
      dir,
      '.claude/settings.json',
      JSON.stringify({
        enabledPlugins: { 'superpowers@claude-plugins-official': true, 'bmad-method@bmad': true },
      }),
    );
    commit(dir, '.claude/settings.json');
    const s = await discoverSources(ctx, dir, ctx.superpowersPin);
    expect(s.find((x) => x.path.endsWith('#superpowers@claude-plugins-official'))?.origin).toBe('pinned');
    expect(s.find((x) => x.path.endsWith('#bmad-method@bmad'))).toMatchObject({
      origin: 'blocked',
      reason: 'bật workflow bmad khác với workflow của run (nạp chéo)',
    });
  });

  it('run BMAD: bmad@ bật trong repo là pinned; bmad-method@ cùng workflow nhưng khác tên plugin thì chặn', async () => {
    const { ctx } = realGitCtx();
    const dir = repo();
    put(
      dir,
      '.claude/settings.json',
      JSON.stringify({ enabledPlugins: { 'bmad@x': true, 'bmad-toolbox@bmad': true } }),
    );
    commit(dir, '.claude/settings.json');
    const s = await discoverSources(ctx, dir, ctx.bmadPin);
    expect(s.find((x) => x.path.endsWith('#bmad@x'))?.origin).toBe('pinned');
    expect(s.find((x) => x.path.endsWith('#bmad-toolbox@bmad'))).toMatchObject({
      origin: 'blocked',
      reason: `bật plugin bmad-toolbox ${PARALLEL_PLUGIN_REASON}`,
    });
  });

  it('run BMAD: _bmad/scripts đã commit giống byte bản ghim → project; khác một byte → blocked kèm cách xử lý', async () => {
    const { ctx } = realGitCtx();
    const dir = repo();
    copyPinScripts(ctx, dir);
    commit(dir, '_bmad');
    const same = await discoverSources(ctx, dir, ctx.bmadPin);
    expect(same).toEqual([{ path: join(dir, '_bmad', 'scripts'), kind: 'bmad', origin: 'project' }]);

    put(dir, '_bmad/scripts/setup.py', 'print("setup!")\n');
    const changed = await discoverSources(ctx, dir, ctx.bmadPin);
    expect(blockedOf(changed)).toEqual([
      {
        path: join(dir, '_bmad', 'scripts'),
        kind: 'bmad',
        origin: 'blocked',
        reason: BMAD_SCRIPT_MISMATCH_REASON,
        fix:
          `Xem: git -C '${dir}' status -- _bmad/scripts; khôi phục: git -C '${dir}' checkout HEAD -- _bmad/scripts, ` +
          'hoặc xóa _bmad/scripts rồi chạy crew-mac bmad setup-project.',
      },
    ]);
  });

  it('run BMAD: _bmad/scripts thừa một file hoặc có symlink thì khác bản ghim', async () => {
    const { ctx } = realGitCtx();
    const dir = repo();
    copyPinScripts(ctx, dir);
    put(dir, '_bmad/scripts/them.py', 'x\n');
    commit(dir, '_bmad');
    expect(blockedOf(await discoverSources(ctx, dir, ctx.bmadPin))[0]?.reason).toBe(
      BMAD_SCRIPT_MISMATCH_REASON,
    );
    const linked = repo();
    mkdirSync(join(linked, '_bmad', 'scripts'), { recursive: true });
    symlinkSync(
      join(workflowPinDir(ctx.home, ctx.bmadPin), 'skills', 'bmad', 'scripts', 'setup.py'),
      join(linked, '_bmad', 'scripts', 'setup.py'),
    );
    expect(blockedOf(await discoverSources(ctx, linked, ctx.bmadPin))[0]?.reason).toBe(
      BMAD_SCRIPT_MISMATCH_REASON,
    );
  });

  it('run BMAD: .pyc đã commit dưới _bmad/scripts là khác bản ghim; .pyc chưa track (do run tạo) bỏ qua', async () => {
    const { ctx } = realGitCtx();
    const dir = repo();
    copyPinScripts(ctx, dir);
    commit(dir, '_bmad');
    put(dir, '_bmad/scripts/__pycache__/config_utils.cpython-312.pyc', 'bytecode do run tạo');
    expect(await discoverSources(ctx, dir, ctx.bmadPin)).toEqual([
      { path: join(dir, '_bmad', 'scripts'), kind: 'bmad', origin: 'project' },
    ]);
    commit(dir, '_bmad');
    expect(blockedOf(await discoverSources(ctx, dir, ctx.bmadPin))).toEqual([
      expect.objectContaining({ path: join(dir, '_bmad', 'scripts'), reason: BMAD_SCRIPT_MISMATCH_REASON }),
    ]);
    const flat = repo();
    copyPinScripts(ctx, flat);
    put(flat, '_bmad/scripts/setup.pyc', 'mã khác');
    commit(flat, '_bmad');
    expect(blockedOf(await discoverSources(ctx, flat, ctx.bmadPin))[0]?.reason).toBe(
      BMAD_SCRIPT_MISMATCH_REASON,
    );
  });

  it('run BMAD: _bmad/scripts chưa commit nhưng giống byte → pinned (run trước bị ngắt)', async () => {
    const { ctx } = realGitCtx();
    const dir = repo();
    copyPinScripts(ctx, dir);
    writeFileSync(join(dir, '_bmad', 'scripts', '.DS_Store'), 'finder');
    expect(await discoverSources(ctx, dir, ctx.bmadPin)).toEqual([
      { path: join(dir, '_bmad', 'scripts'), kind: 'bmad', origin: 'pinned' },
    ]);
  });

  it('run BMAD: _bmad/config.toml chưa track → blocked UNTRACKED_REASON; sửa dở → blocked DIRTY_REASON', async () => {
    const { ctx } = realGitCtx();
    const dir = repo();
    put(dir, '_bmad/config.toml', '[core]\nproject_name = "a"\n');
    expect(blockedOf(await discoverSources(ctx, dir, ctx.bmadPin))).toEqual([
      expect.objectContaining({
        path: join(dir, '_bmad', 'config.toml'),
        kind: 'bmad',
        reason: UNTRACKED_REASON,
      }),
    ]);
    commit(dir, '_bmad/config.toml');
    expect(await discoverSources(ctx, dir, ctx.bmadPin)).toEqual([
      { path: join(dir, '_bmad', 'config.toml'), kind: 'bmad', origin: 'project' },
    ]);
    put(dir, '_bmad/config.toml', '[core]\nproject_name = "b"\n');
    put(dir, '_bmad/custom/bmad-prd.toml', '[x]\n');
    const dirty = blockedOf(await discoverSources(ctx, dir, ctx.bmadPin));
    expect(dirty.map((s) => [s.path, s.reason])).toEqual([
      [join(dir, '_bmad', 'config.toml'), DIRTY_REASON],
      [join(dir, '_bmad', 'custom', 'bmad-prd.toml'), UNTRACKED_REASON],
    ]);
  });

  it('run BMAD: _bmad/custom/bmad-prd.user.toml chưa track → blocked BMAD_PERSONAL_REASON; đã commit sạch → project', async () => {
    const { ctx } = realGitCtx();
    const dir = repo();
    put(dir, '_bmad/custom/bmad-prd.user.toml', 'name = "owner"\n');
    expect(blockedOf(await discoverSources(ctx, dir, ctx.bmadPin))).toEqual([
      {
        path: join(dir, '_bmad', 'custom', 'bmad-prd.user.toml'),
        kind: 'bmad',
        origin: 'blocked',
        reason: BMAD_PERSONAL_REASON,
        fix: 'Xử lý: xóa _bmad/custom/bmad-prd.user.toml (lớp cá nhân không dùng trong run agent), hoặc commit nếu cố ý dùng cho cả nhóm.',
      },
    ]);
    commit(dir, '_bmad');
    expect(await discoverSources(ctx, dir, ctx.bmadPin)).toEqual([
      { path: join(dir, '_bmad', 'custom', 'bmad-prd.user.toml'), kind: 'bmad', origin: 'project' },
    ]);
    put(dir, '_bmad/custom/bmad-prd.user.toml', 'name = "khác"\n');
    expect(blockedOf(await discoverSources(ctx, dir, ctx.bmadPin))[0]?.reason).toBe(BMAD_PERSONAL_REASON);
  });

  it('run BMAD: _bmad/memory/** và _bmad-output/** không phải nguồn nạp, không xét', async () => {
    const { ctx } = realGitCtx();
    const dir = repo();
    put(dir, '_bmad/memory/bmad-prd/log.md', 'nhật ký\n');
    put(dir, '_bmad/memory/x.user.toml', 'a = 1\n');
    put(dir, '_bmad-output/planning-artifacts/prd.md', '# PRD\n');
    expect(await discoverSources(ctx, dir, ctx.bmadPin)).toEqual([]);
  });

  it('run Superpowers: _bmad/ lạ chưa track không ảnh hưởng (không có nguồn nào kind bmad)', async () => {
    const { ctx } = realGitCtx();
    const dir = repo();
    put(dir, '_bmad/config.toml', 'x\n');
    put(dir, '_bmad/scripts/setup.py', 'khác\n');
    put(dir, '_bmad/custom/a.user.toml', 'x\n');
    put(dir, '.claude/skills/s/SKILL.md', 's\n');
    commit(dir, '.claude');
    const s = await discoverSources(ctx, dir, ctx.superpowersPin);
    expect(s.some((x) => x.kind === 'bmad')).toBe(false);
    expect(blockedOf(s)).toEqual([]);
  });

  it('repo chỉ có _bmad (không .claude, không .mcp.json): run BMAD vẫn gọi git và xét _bmad', async () => {
    const mac = fakeMac();
    const real = createRunner();
    const calls: string[][] = [];
    const ctx: MacContext = {
      ...mac.ctx,
      runner: {
        run: (command, args, options) => {
          calls.push([...args]);
          return real.run(command, args, options);
        },
      },
    };
    const dir = repo();
    put(dir, '_bmad/config.toml', 'x\n');
    const s = await discoverSources(ctx, dir, ctx.bmadPin);
    expect(blockedOf(s).map((x) => x.reason)).toEqual([UNTRACKED_REASON]);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((a) => a.includes('_bmad') || a.includes('rev-parse'))).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(3);
  });
});

describe('compareBmadScripts', () => {
  it('đúng tập file và từng byte của <pin>/skills/bmad/scripts', () => {
    const { ctx } = realGitCtx();
    const dir = workflowPinDir(ctx.home, ctx.bmadPin);
    const files = new Map([['setup.py', readFileSync(join(dir, 'skills', 'bmad', 'scripts', 'setup.py'))]]);
    expect(compareBmadScripts(files, dir)).toBe(true);
    expect(compareBmadScripts(new Map([['setup.py', Buffer.from('khác')]]), dir)).toBe(false);
    expect(compareBmadScripts(new Map([...files, ['tests/a.py', Buffer.from('')]]), dir)).toBe(false);
    expect(compareBmadScripts(new Map(), dir)).toBe(false);
    expect(compareBmadScripts(files, join(ctx.home, 'không-có'))).toBe(false);
  });
});
