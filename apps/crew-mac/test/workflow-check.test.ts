import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { runInitCheck, workflowCheck } from '../src/commands/workflow-check.js';
import type { MacContext } from '../src/context.js';
import { createRunner } from '../src/system.js';
import { installSuperpowersPin } from '../src/workflows/install.js';
import { lastRunWorkflow, worktreeWorkflowStampPath } from '../src/workflows/inventory.js';
import { pinDir as workflowPinDir } from '../src/workflows/pin.js';
import { BUILTIN_AGENTS, BUILTIN_SKILLS } from '../src/workflows/run-init.js';
import { FIXTURE_BMAD_PIN, FIXTURE_PIN, fakeMac } from './helpers/fake-mac.js';

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

/** Repo git thật không có `.claude`, `.mcp.json` hay `_bmad`. */
function bareRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'crew-wfc-bare-'));
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'README.md'), 'x\n');
  git(dir, 'add', 'README.md');
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
    expect(r.lines[0]).toBe(
      `crew-workflow ok pin=superpowers@9.9.9 rev=ffffffffffff sum=${FIXTURE_PIN.checksum.slice(0, 12)} project=2 pinned-dup=0`,
    );
  });

  it('--plugin-dir là thư mục ghim BMAD, repo sạch thì ok với dòng pin bmad', async () => {
    const { ctx } = installedMac();
    const r = await workflowCheck(ctx, {
      root: bareRepo(),
      pluginDir: workflowPinDir(ctx.home, ctx.bmadPin),
    });
    expect(r).toEqual({
      ok: true,
      lines: [
        `crew-workflow ok pin=bmad@9.9.9-next rev=bbbbbbbbbbbb sum=${FIXTURE_BMAD_PIN.checksum.slice(0, 12)} project=0 pinned-dup=0`,
      ],
    });
  });

  it('run BMAD trên repo bật superpowers thì blocked nạp chéo; run Superpowers cùng repo vẫn ok', async () => {
    const { ctx, pinDir: spDir } = installedMac();
    const root = worktree();
    writeFileSync(
      join(root, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'superpowers@claude-plugins-official': true } }),
    );
    git(root, 'add', '.claude/settings.json');
    git(root, 'commit', '-q', '-m', 's');
    const bmad = await workflowCheck(ctx, { root, pluginDir: workflowPinDir(ctx.home, ctx.bmadPin) });
    expect(bmad.ok).toBe(false);
    expect(bmad.lines.join('\n')).toContain('bật workflow superpowers khác với workflow của run (nạp chéo)');
    expect((await workflowCheck(ctx, { root, pluginDir: spDir })).ok).toBe(true);
  });

  it('thư mục ghim BMAD sửa một byte thì WORKFLOW_SOURCE_MISMATCH', async () => {
    const { ctx } = installedMac();
    const dir = workflowPinDir(ctx.home, ctx.bmadPin);
    writeFileSync(join(dir, 'skills', 'm1', 'SKILL.md'), '---\nname: m2\n---\n');
    const r = await workflowCheck(ctx, { root: bareRepo(), pluginDir: dir });
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toContain(`crew-workflow blocked: ${dir} (WORKFLOW_SOURCE_MISMATCH)`);
  });

  it('dấu .in_use trong thư mục ghim không làm đổi checksum', async () => {
    const { ctx } = installedMac();
    const dir = workflowPinDir(ctx.home, ctx.bmadPin);
    mkdirSync(join(dir, '.in_use'));
    writeFileSync(join(dir, '.in_use', '11111111-2222-4333-8444-555555555555'), '4242 1760000000\n');
    expect((await workflowCheck(ctx, { root: bareRepo(), pluginDir: dir })).ok).toBe(true);
  });

  it('ghi dấu workflow của run cho worktree (kể cả khi bị chặn); --plugin-dir lạ thì không ghi', async () => {
    const { ctx, home, pinDir } = installedMac();
    const root = worktree();
    expect(lastRunWorkflow(home, root)).toBeNull();
    await workflowCheck(ctx, { root, pluginDir: join(home, 'không-phải-ghim') });
    expect(lastRunWorkflow(home, root)).toBeNull();
    await workflowCheck(ctx, { root, pluginDir: workflowPinDir(home, ctx.bmadPin) });
    expect(lastRunWorkflow(home, root)).toBe('bmad');
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(root, '.claude', 'agents', 'chua-track.md'), 'x');
    expect((await workflowCheck(ctx, { root, pluginDir: pinDir })).ok).toBe(false);
    expect(lastRunWorkflow(home, root)).toBe('superpowers');
    expect(readFileSync(worktreeWorkflowStampPath(home, root), 'utf8')).toBe('superpowers\n');
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
    expect(r.lines).toEqual([
      `crew-workflow blocked: --plugin-dir ${cache} không phải bản ghim của workflow nào đã chứng nhận ` +
        `(${workflowPinDir(home, FIXTURE_PIN)}, ${workflowPinDir(home, FIXTURE_BMAD_PIN)})`,
    ]);
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
      `crew-workflow blocked: ${root}/.claude/skills/stray (không được git track trong worktree agent). ` +
        `Xử lý: commit (git -C '${root}' add -- '.claude/skills/stray/SKILL.md' rồi commit) hoặc xóa file đó.`,
    );
  });

  it('SKILL.md đã track mà sửa dở thì run vẫn chạy, in dòng warn kèm lệnh xem', async () => {
    const { ctx, pinDir } = installedMac();
    const root = worktree();
    writeFileSync(join(root, '.claude', 'skills', 'du-an', 'SKILL.md'), 'sửa dở');
    const r = await workflowCheck(ctx, { root, pluginDir: pinDir });
    expect(r.ok).toBe(true);
    expect(r.lines[0]).toMatch(/^crew-workflow ok /);
    expect(r.lines[1]).toBe(
      `crew-workflow warn: ${root}/.claude/skills/du-an (đã sửa so với commit (chưa commit) trong worktree agent). ` +
        `Xem: git -C '${root}' diff HEAD -- '.claude/skills/du-an/SKILL.md'; bỏ: git -C '${root}' checkout HEAD -- '.claude/skills/du-an/SKILL.md', hoặc commit.`,
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

  it('không nạp workflow ghim nào, superpowers chỉ từ cache, hoặc không có system/init thì blocked', async () => {
    const { ctx, home, pinDir } = installedMac();
    const root = worktree();
    const noPin = JSON.parse(initLine(pinDir)) as { plugins: unknown[] };
    noPin.plugins = noPin.plugins.slice(1);
    const r = await runInitCheck(ctx, { root, log: streamLog(JSON.stringify(noPin)) });
    expect(r).toEqual({ ok: false, lines: ['crew-workflow blocked: không nạp workflow ghim nào'] });
    const cache = join(home, '.claude', 'plugins', 'cache', 'x', 'superpowers', '9.9.9');
    const fromCache = JSON.parse(initLine(pinDir)) as { plugins: { path: string }[] };
    (fromCache.plugins[0] as { path: string }).path = cache;
    const c = await runInitCheck(ctx, { root, log: streamLog(JSON.stringify(fromCache)) });
    expect(c.ok).toBe(false);
    expect(c.lines.join('\n')).toContain(`không nạp superpowers từ bản ghim ${pinDir}`);
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

describe('runInitCheck run BMAD', () => {
  /** `system/init` của run BMAD theo hình dạng đo ở SP-0 (claude 2.1.295, `bmad@inline`). */
  function bmadInit(dir: string, extra: { plugins?: unknown[]; skills?: string[] } = {}) {
    return streamLog(
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        plugins: [
          { name: 'bmad', path: dir, source: 'bmad@inline', version: '9.9.9-next' },
          { name: 'cc-plugin-telemetry', path: 'builtin', source: 'cc-plugin-telemetry@builtin' },
          ...(extra.plugins ?? []),
        ],
        skills: ['bmad:bmad-prd', 'bmad:bmad-architecture', ...BUILTIN_SKILLS, ...(extra.skills ?? [])],
        agents: [...BUILTIN_AGENTS],
        mcp_servers: [{ name: 'claude.ai Claude Docs', status: 'connected', source: 'claudeai' }],
      }),
    );
  }

  it('plugin bmad từ thư mục ghim và skill bmad:* thì đạt', async () => {
    const { ctx } = installedMac();
    const dir = workflowPinDir(ctx.home, ctx.bmadPin);
    expect(await runInitCheck(ctx, { root: bareRepo(), log: bmadInit(dir) })).toEqual({
      ok: true,
      lines: ['crew-workflow init ok: bmad@9.9.9-next từ bản ghim, 2 skill bmad:*'],
    });
  });

  it('thêm superpowers từ cache owner thì nạp nhiều hơn một workflow', async () => {
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
    const log = bmadInit(workflowPinDir(ctx.home, ctx.bmadPin), {
      plugins: [
        { name: 'superpowers', path: cache, source: 'superpowers@claude-plugins-official', version: '9.9.9' },
      ],
      skills: ['superpowers:brainstorming'],
    });
    expect(await runInitCheck(ctx, { root: bareRepo(), log })).toEqual({
      ok: false,
      lines: ['crew-workflow blocked: nạp nhiều hơn một workflow (bmad, superpowers)'],
    });
  });

  it('plugin bmad từ marketplace, đúng version mà khác checksum thì WORKFLOW_SOURCE_MISMATCH', async () => {
    const { ctx, home } = installedMac();
    const market = join(home, '.claude', 'plugins', 'marketplaces', 'bmad');
    mkdirSync(market, { recursive: true });
    writeFileSync(join(market, 'README.md'), 'khác\n');
    const init = JSON.parse(bmadInit(market).split('\n')[2] as string) as { plugins: { source: string }[] };
    (init.plugins[0] as { source: string }).source = 'bmad@bmad';
    const r = await runInitCheck(ctx, { root: bareRepo(), log: streamLog(JSON.stringify(init)) });
    expect(r.ok).toBe(false);
    expect(r.lines).toContain(
      `crew-workflow blocked: plugin bmad@bmad (${market}): WORKFLOW_SOURCE_MISMATCH, khác bản ghim 9.9.9-next`,
    );
    expect(r.lines).toContain(
      `crew-workflow blocked: không nạp bmad từ bản ghim ${workflowPinDir(ctx.home, ctx.bmadPin)}`,
    );
  });
});

describe('runInitCheck với system/init thật của run Paperclip (đã ẩn định danh)', () => {
  // Log thật: superpowers 6.4.1 từ thư mục ghim; test thay đường dẫn và version bằng pin giả.
  const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'paperclip-run-init.json');

  function realInit(
    pinDir: string,
    root: string,
    mcp?: (servers: { name: string; source: string }[]) => void,
  ) {
    const init = JSON.parse(
      readFileSync(FIXTURE, 'utf8')
        .replaceAll('__PIN__', pinDir)
        .replaceAll('__PIN_VERSION__', FIXTURE_PIN.version)
        .replaceAll('__ROOT__', root),
    );
    mcp?.(init.mcp_servers);
    return streamLog(JSON.stringify(init));
  }

  function paperclipWorktree(): string {
    const root = worktree();
    const skill = join(root, '.paperclip-runtime', 'claude', 'skills', '.claude', 'skills', 'paperclip');
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, 'SKILL.md'), '---\nname: paperclip\n---\n');
    return root;
  }

  it('hai MCP Paperclip tự gắn (source=dynamic) được cho phép, run sạch đạt', async () => {
    const { ctx, pinDir } = installedMac();
    const root = paperclipWorktree();
    const r = await runInitCheck(ctx, { root, log: realInit(pinDir, root) });
    expect(r).toEqual({
      ok: true,
      lines: ['crew-workflow init ok: superpowers@9.9.9 từ bản ghim, 15 skill superpowers:*'],
    });
  });

  it('MCP dynamic khác tên, hoặc tên Paperclip mà nguồn khác dynamic, vẫn bị chặn', async () => {
    const { ctx, pinDir } = installedMac();
    const root = paperclipWorktree();
    const other = await runInitCheck(ctx, {
      root,
      log: realInit(pinDir, root, (servers) => servers.push({ name: 'Lạ', source: 'dynamic' })),
    });
    expect(other).toEqual({
      ok: false,
      lines: ['crew-workflow blocked: mcp Lạ (source=dynamic): ngoài danh sách cho phép'],
    });
    const spoof = await runInitCheck(ctx, {
      root,
      log: realInit(pinDir, root, (servers) => {
        (servers[0] as { source: string }).source = 'user';
      }),
    });
    expect(spoof.lines).toEqual([
      'crew-workflow blocked: mcp Paperclip projects (source=user): ngoài danh sách cho phép',
    ]);
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
