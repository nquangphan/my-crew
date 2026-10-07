import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { runInitCheck, workflowCheck } from '../src/commands/workflow-check.js';
import type { MacContext } from '../src/context.js';
import { createRunner } from '../src/system.js';
import { installSuperpowersPin } from '../src/workflows/install.js';
import { BUILTIN_AGENTS, BUILTIN_SKILLS } from '../src/workflows/run-init.js';
import { fakeMac } from './helpers/fake-mac.js';

function git(cwd: string, ...args: string[]): void {
  execFileSync('/usr/bin/git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
    cwd,
    stdio: 'ignore',
  });
}

function worktree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'crew-wfc-'));
  git(dir, 'init', '-q');
  mkdirSync(join(dir, '.claude', 'skills', 'du-an'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'skills', 'du-an', 'SKILL.md'), '---\nname: du-an\n---\n');
  mkdirSync(join(dir, '.claude', 'agents'));
  writeFileSync(join(dir, '.claude', 'agents', 'soat-xet.md'), '---\nname: soat-xet\n---\n');
  git(dir, 'add', '.claude');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

function installedMac(): { ctx: MacContext; home: string; pinDir: string } {
  const mac = fakeMac();
  const ctx = { ...mac.ctx, runner: createRunner() };
  return { ctx, home: mac.home, pinDir: installSuperpowersPin(ctx).dir };
}

describe('workflowCheck', () => {
  it('đúng pin, worktree sạch thì ok', async () => {
    const { ctx, pinDir } = installedMac();
    const r = await workflowCheck(ctx, { root: worktree(), pluginDir: pinDir });
    expect(r.ok).toBe(true);
    expect(r.lines[0]).toMatch(/^crew-workflow ok pin=superpowers@9\.9\.9 project=2/);
  });

  it('--plugin-dir là cache của owner, không phải bản ghim', async () => {
    const { ctx, home } = installedMac();
    const cache = join(
      home,
      '.claude',
      'plugins',
      'cache',
      'claude-plugins-official',
      'superpowers',
      '9.9.9',
    );
    const r = await workflowCheck(ctx, { root: worktree(), pluginDir: cache });
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toContain('không phải bản ghim');
  });

  it('thư mục ghim bị sửa thì WORKFLOW_SOURCE_MISMATCH', async () => {
    const { ctx, pinDir } = installedMac();
    writeFileSync(join(pinDir, 'a.txt'), 'bị sửa\n');
    const r = await workflowCheck(ctx, { root: worktree(), pluginDir: pinDir });
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toContain('WORKFLOW_SOURCE_MISMATCH');
  });

  it('file thực thi của bản ghim mất bit x thì blocked', async () => {
    const { ctx, pinDir } = installedMac();
    chmodSync(join(pinDir, 'dir', 'b.txt'), 0o644);
    const r = await workflowCheck(ctx, { root: worktree(), pluginDir: pinDir });
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toContain('thiếu bit thực thi: dir/b.txt');
  });

  it('thư mục ghim chưa cài thì blocked, không ném lỗi', async () => {
    const mac = fakeMac();
    const ctx = { ...mac.ctx, runner: createRunner() };
    const pinDir = join(mac.home, '.crew', 'workflows', 'superpowers', '9.9.9-ffffffffffff');
    const r = await workflowCheck(ctx, { root: worktree(), pluginDir: pinDir });
    expect(r.ok).toBe(false);
    expect(r.lines[0]).toContain(`crew-workflow blocked: ${pinDir}`);
  });

  it('skill chưa track trong worktree thì blocked kèm lý do', async () => {
    const { ctx, pinDir } = installedMac();
    const root = worktree();
    mkdirSync(join(root, '.claude', 'skills', 'stray'));
    writeFileSync(join(root, '.claude', 'skills', 'stray', 'SKILL.md'), 'x');
    const r = await workflowCheck(ctx, { root, pluginDir: pinDir });
    expect(r.ok).toBe(false);
    expect(r.lines).toContain(
      `crew-workflow blocked: ${root}/.claude/skills/stray (không được git track trong worktree agent)`,
    );
  });
});

/** Dòng `system/init` theo đúng hình dạng đo được trên Mac mini (claude 2.1.289). */
function initLine(
  pinDir: string,
  extra: { plugins?: unknown[]; skills?: string[]; agents?: string[]; mcp?: unknown[] } = {},
) {
  return JSON.stringify({
    type: 'system',
    subtype: 'init',
    plugins: [
      { name: 'superpowers', path: pinDir, source: 'superpowers@inline', version: '9.9.9' },
      { name: 'cc-plugin-telemetry', path: 'builtin', source: 'cc-plugin-telemetry@builtin' },
      ...(extra.plugins ?? []),
    ],
    skills: ['du-an', 'superpowers:brainstorming', ...BUILTIN_SKILLS, ...(extra.skills ?? [])],
    agents: [...BUILTIN_AGENTS, 'soat-xet', ...(extra.agents ?? [])],
    mcp_servers: [
      { name: 'claude.ai Claude Docs', status: 'connected', source: 'claudeai' },
      ...(extra.mcp ?? []),
    ],
  });
}

function streamLog(init: string): string {
  return [
    JSON.stringify({ type: 'system', subtype: 'hook_started', hook_name: 'SessionStart:startup' }),
    JSON.stringify({ type: 'system', subtype: 'hook_response' }),
    init,
    JSON.stringify({ type: 'result', subtype: 'success', result: 'ok' }),
    '',
  ].join('\n');
}

describe('runInitCheck', () => {
  it('đọc system/init theo subtype (dòng đầu là hook) và cho qua run sạch', async () => {
    const { ctx, pinDir } = installedMac();
    const r = await runInitCheck(ctx, { root: worktree(), log: streamLog(initLine(pinDir)) });
    expect(r).toEqual({
      ok: true,
      lines: ['crew-workflow init ok: superpowers@9.9.9 từ bản ghim, 1 skill superpowers:*'],
    });
  });

  it('skill cá nhân, plugin user-scope, superpowers từ cache owner và MCP user đều bị chỉ ra', async () => {
    const { ctx, home, pinDir } = installedMac();
    const cache = join(
      home,
      '.claude',
      'plugins',
      'cache',
      'claude-plugins-official',
      'superpowers',
      '9.9.8',
    );
    const log = streamLog(
      initLine(pinDir, {
        plugins: [
          { name: 'context7', path: '/x/context7', source: 'context7@claude-plugins-official' },
          {
            name: 'superpowers',
            path: cache,
            source: 'superpowers@claude-plugins-official',
            version: '9.9.8',
          },
        ],
        skills: ['tro-ly', 'context7:docs'],
        agents: ['ca-nhan'],
        mcp: [{ name: 'riêng', status: 'connected', source: 'user' }],
      }),
    );
    const r = await runInitCheck(ctx, { root: worktree(), log });
    expect(r.ok).toBe(false);
    const text = r.lines.join('\n');
    expect(text).toContain('plugin context7@claude-plugins-official');
    expect(text).toContain(`plugin superpowers@claude-plugins-official (${cache})`);
    expect(text).toContain('WORKFLOW_SOURCE_MISMATCH');
    expect(text).toContain('skill tro-ly');
    expect(text).toContain('skill context7:docs');
    expect(text).toContain('agent ca-nhan');
    expect(text).toContain('mcp riêng (source=user)');
  });

  it('thiếu superpowers từ bản ghim hoặc không có system/init thì blocked', async () => {
    const { ctx, pinDir } = installedMac();
    const root = worktree();
    const noPin = JSON.parse(initLine(pinDir)) as { plugins: unknown[] };
    noPin.plugins = noPin.plugins.slice(1);
    const r = await runInitCheck(ctx, { root, log: streamLog(JSON.stringify(noPin)) });
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toContain('không nạp Superpowers từ bản ghim');
    const none = await runInitCheck(ctx, { root, log: 'không phải json\n{"type":"result"}\n' });
    expect(none).toEqual({ ok: false, lines: ['crew-workflow blocked: log không có dòng system/init'] });
  });

  it('plugin project đã commit và skill Paperclip trong .paperclip-runtime được cho phép', async () => {
    const { ctx, pinDir } = installedMac();
    const root = worktree();
    writeFileSync(
      join(root, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'context7@claude-plugins-official': true } }),
    );
    git(root, 'add', '.claude/settings.json');
    git(root, 'commit', '-q', '-m', 's');
    mkdirSync(join(root, '.paperclip-runtime', 'claude', '.claude', 'skills', 'paperclip'), {
      recursive: true,
    });
    writeFileSync(
      join(root, '.paperclip-runtime', 'claude', '.claude', 'skills', 'paperclip', 'SKILL.md'),
      'x',
    );
    const log = streamLog(
      initLine(pinDir, {
        plugins: [{ name: 'context7', path: '/x/context7', source: 'context7@claude-plugins-official' }],
        skills: ['context7:docs', 'paperclip'],
      }),
    );
    expect((await runInitCheck(ctx, { root, log })).ok).toBe(true);
  });
});

describe('CLI workflow-check, run-init-check', () => {
  function io(ctx: MacContext) {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env: {}, context: ctx },
    };
  }

  it('thiếu hoặc sai đường dẫn thì mã 2; sạch thì 0; blocked thì 78', async () => {
    const { ctx, pinDir } = installedMac();
    const root = worktree();
    expect(await main(['workflow-check', '--plugin-dir', pinDir], io(ctx).io)).toBe(2);
    expect(await main(['workflow-check', '--root', 'rel', '--plugin-dir', pinDir], io(ctx).io)).toBe(2);
    const ok = io(ctx);
    expect(await main(['workflow-check', '--root', root, '--plugin-dir', pinDir], ok.io)).toBe(0);
    expect(ok.out[0]).toContain('crew-workflow ok');
    writeFileSync(join(root, '.claude', 'settings.local.json'), '{"enabledPlugins":{"x@y":true}}');
    const blocked = io(ctx);
    expect(await main(['workflow-check', '--root', root, '--plugin-dir', pinDir], blocked.io)).toBe(78);
    expect(blocked.err.join('\n')).toContain('settings.local.json');
  });

  it('run-init-check đọc log từ file', async () => {
    const { ctx, home, pinDir } = installedMac();
    const root = worktree();
    const file = join(home, 'run.jsonl');
    writeFileSync(file, streamLog(initLine(pinDir)));
    expect(await main(['run-init-check', '--root', root, '--log', file], io(ctx).io)).toBe(0);
    writeFileSync(file, streamLog(initLine(pinDir, { skills: ['tro-ly'] })));
    const bad = io(ctx);
    expect(await main(['run-init-check', '--root', root, '--log', file], bad.io)).toBe(78);
    expect(bad.err.join('\n')).toContain('skill tro-ly');
    expect(await main(['run-init-check', '--root', root], io(ctx).io)).toBe(2);
    expect(await main(['run-init-check', '--root', root, '--log', join(home, 'không-có')], io(ctx).io)).toBe(
      1,
    );
  });
});
