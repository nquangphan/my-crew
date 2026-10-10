import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { workflowsCommand } from '../src/commands/workflows.js';
import { installSuperpowersPin } from '../src/workflows/install.js';
import { pinDir } from '../src/workflows/pin.js';
import { FIXTURE_BMAD_PIN, FIXTURE_PIN, fakeMac } from './helpers/fake-mac.js';

function capture(mac: ReturnType<typeof fakeMac>) {
  const out: string[] = [];
  const err: string[] = [];
  mac.ctx.out = (l) => out.push(l);
  return { out, err, errFn: (l: string) => err.push(l) };
}

describe('crew-mac workflows', () => {
  it('list --json: hai workflow kèm thư mục và trạng thái cài', async () => {
    const mac = fakeMac();
    const t = capture(mac);
    expect(await workflowsCommand(mac.ctx, ['list', '--json'], t.errFn)).toBe(0);
    expect(JSON.parse(t.out.join('\n'))).toEqual([
      {
        id: 'superpowers',
        version: FIXTURE_PIN.version,
        revision: FIXTURE_PIN.revision,
        checksum: FIXTURE_PIN.checksum,
        runtimes: ['claude_local', 'codex_local', 'opencode_local'],
        isDefault: true,
        purpose: 'design/plan/task, code, review, merge',
        dir: pinDir(mac.home, FIXTURE_PIN),
        installed: false,
      },
      {
        id: 'bmad',
        version: FIXTURE_BMAD_PIN.version,
        revision: FIXTURE_BMAD_PIN.revision,
        checksum: FIXTURE_BMAD_PIN.checksum,
        runtimes: ['claude_local'],
        isDefault: false,
        purpose: 'epic/story',
        dir: pinDir(mac.home, FIXTURE_BMAD_PIN),
        installed: true,
      },
    ]);
  });

  it('list không --json: mỗi workflow một dòng, phân biệt chưa cài và lệch checksum', async () => {
    const mac = fakeMac();
    writeFileSync(join(pinDir(mac.home, FIXTURE_BMAD_PIN), 'skills', 'm1', 'SKILL.md'), 'sửa\n');
    const t = capture(mac);
    expect(await workflowsCommand(mac.ctx, ['list'], t.errFn)).toBe(0);
    expect(t.out).toEqual([
      'superpowers 9.9.9 rev=ffffffffffff chưa cài mặc định',
      'bmad 9.9.9-next rev=bbbbbbbbbbbb lệch checksum -',
    ]);
    installSuperpowersPin(mac.ctx);
    t.out.length = 0;
    await workflowsCommand(mac.ctx, ['list'], t.errFn);
    expect(t.out[0]).toBe('superpowers 9.9.9 rev=ffffffffffff đã cài mặc định');
  });

  it('install: cài cả hai, in extraArgs cho vai thường và vai bmad, không đụng sshd/launchctl', async () => {
    const mac = fakeMac();
    const t = capture(mac);
    expect(await workflowsCommand(mac.ctx, ['install'], t.errFn)).toBe(0);
    const sp = pinDir(mac.home, FIXTURE_PIN);
    const bmad = pinDir(mac.home, FIXTURE_BMAD_PIN);
    expect(t.out).toEqual([
      `extraArgs (vai thường): ${JSON.stringify(['--setting-sources', 'project,local', '--plugin-dir', sp])}`,
      `extraArgs (vai bmad): ${JSON.stringify(['--setting-sources', 'project,local', '--plugin-dir', bmad])}`,
    ]);
    expect(mac.runner.calls.filter((c) => /launchctl|sshd/.test(c.command))).toEqual([]);
  });

  it('install: lỗi cài thì in câu lỗi, thoát 1', async () => {
    const mac = fakeMac({ ownerSuperpowers: false });
    const t = capture(mac);
    expect(await workflowsCommand(mac.ctx, ['install'], t.errFn)).toBe(1);
    expect(t.err.join('\n')).toContain('crew-mac: Chưa có Superpowers 9.9.9');
    expect(t.out).toEqual([]);
  });

  it('qua CLI: list --json chạy, lệnh con lạ thoát 2 kèm cách dùng', async () => {
    const mac = fakeMac();
    const out: string[] = [];
    const err: string[] = [];
    const push = (l: string) => out.push(l);
    const io = { out: push, err: (l: string) => err.push(l), env: {}, context: { ...mac.ctx, out: push } };
    expect(await main(['workflows', 'list', '--json'], io)).toBe(0);
    expect(JSON.parse(out.join('\n'))).toHaveLength(2);
    expect(await main(['workflows', 'lung-tung'], io)).toBe(2);
    expect(err.join('\n')).toContain('crew-mac workflows list [--json] | install | gc');
  });
});
