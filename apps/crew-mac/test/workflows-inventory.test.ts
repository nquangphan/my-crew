import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MacContext } from '../src/context.js';
import { createRunner } from '../src/system.js';
import { installSuperpowersPin } from '../src/workflows/install.js';
import { classifyOrigin, discoverSources } from '../src/workflows/inventory.js';
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
  it('skill đã commit là project; skill chưa track, file lạ trong skill đã track và settings.local.json bật hook là blocked', async () => {
    const { ctx } = realGitCtx();
    const dir = worktree();
    mkdirSync(join(dir, '.claude', 'skills', 'stray'));
    writeFileSync(join(dir, '.claude', 'skills', 'stray', 'SKILL.md'), 'x');
    mkdirSync(join(dir, '.claude', 'agents'));
    writeFileSync(join(dir, '.claude', 'agents', 'dropped.md'), 'x');
    writeFileSync(join(dir, '.claude', 'settings.local.json'), '{"hooks":{}}');
    const sources = await discoverSources(ctx, dir);
    const byPath = new Map(sources.map((s) => [s.path, s]));
    expect(byPath.get(join(dir, '.claude', 'skills', 'tracked'))).toMatchObject({
      kind: 'skill',
      origin: 'project',
    });
    expect(byPath.get(join(dir, '.claude', 'skills', 'stray'))).toMatchObject({
      kind: 'skill',
      origin: 'blocked',
      reason: 'không được git track trong worktree agent',
    });
    expect(byPath.get(join(dir, '.claude', 'agents', 'dropped.md'))).toMatchObject({
      kind: 'agent',
      origin: 'blocked',
    });
    expect(byPath.get(join(dir, '.claude', 'settings.local.json'))).toMatchObject({
      kind: 'settings',
      origin: 'blocked',
    });

    writeFileSync(join(dir, '.claude', 'skills', 'tracked', 'extra.md'), 'thả thêm');
    const again = await discoverSources(ctx, dir);
    expect(again.find((s) => s.path === join(dir, '.claude', 'skills', 'tracked'))?.origin).toBe('blocked');
  });

  it('settings.local.json không bật plugin hay hook thì không tính; worktree sạch không có blocked', async () => {
    const { ctx } = realGitCtx();
    const dir = worktree();
    writeFileSync(join(dir, '.claude', 'settings.local.json'), '{"permissions":{"allow":[]}}');
    const sources = await discoverSources(ctx, dir);
    expect(sources.filter((s) => s.origin === 'blocked')).toEqual([]);
  });

  it('plugin project lệch pin là blocked WORKFLOW_SOURCE_MISMATCH; đúng pin là pinned; plugin khác là project', async () => {
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

    writeFileSync(
      join(home, '.claude', 'plugins', 'cache', 'claude-plugins-official', 'superpowers', '9.9.9', 'a.txt'),
      'owner nâng bản\n',
    );
    const drifted = await discoverSources(ctx, dir);
    expect(drifted.find((s) => s.path.endsWith('#superpowers@claude-plugins-official'))).toMatchObject({
      origin: 'blocked',
      reason: expect.stringContaining('WORKFLOW_SOURCE_MISMATCH'),
    });
  });

  it('settings.json không được track thì blocked', async () => {
    const { ctx } = realGitCtx();
    const dir = worktree();
    writeFileSync(join(dir, '.claude', 'settings.json'), '{"hooks":{}}');
    const sources = await discoverSources(ctx, dir);
    expect(sources.find((s) => s.path === join(dir, '.claude', 'settings.json'))).toMatchObject({
      origin: 'blocked',
      reason: 'settings.json không được git track',
    });
  });

  it('thư mục ghim không có trong worktree thì không lọt vào danh sách', async () => {
    const { ctx } = realGitCtx();
    installSuperpowersPin(ctx);
    const sources = await discoverSources(ctx, worktree());
    expect(sources.map((s) => s.origin)).toEqual(['project']);
  });
});
