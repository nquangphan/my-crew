import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installSuperpowersPin, readInstalledPlugins } from '../src/workflows/install.js';
import { agentExtraArgs, SUPERPOWERS_PIN, superpowersPinDir } from '../src/workflows/pin.js';
import { assertSkillAllowed, samePin } from '../src/workflows/policy.js';
import { treeChecksum } from '../src/workflows/tree-checksum.js';
import { FIXTURE_PIN, fakeMac, installedPluginsFile, seedOwnerPlugin } from './helpers/fake-mac.js';

function fixtureTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'crew-tree-'));
  mkdirSync(join(dir, 'dir'));
  mkdirSync(join(dir, '.in_use'));
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  writeFileSync(join(dir, 'dir', 'b.txt'), 'b\n');
  writeFileSync(join(dir, '.in_use', 'lock'), 'x\n');
  return dir;
}

describe('treeChecksum', () => {
  it('khớp đúng thuật toán shell (bỏ .in_use ở gốc)', () => {
    expect(treeChecksum(fixtureTree())).toEqual({
      checksum: '887ad97e9e3f192940fb5320cd393c82f31fa65da974ee62ff923e37fe75b6e5',
      files: 2,
    });
  });

  it('.in_use dưới thư mục con vẫn được tính', () => {
    const dir = fixtureTree();
    mkdirSync(join(dir, 'dir', '.in_use'));
    writeFileSync(join(dir, 'dir', '.in_use', 'x'), 'x\n');
    expect(treeChecksum(dir).files).toBe(3);
  });

  it('từ chối symlink', () => {
    const dir = fixtureTree();
    symlinkSync('/etc/hosts', join(dir, 'dir', 'link'));
    expect(() => treeChecksum(dir)).toThrow(/symlink/);
  });
});

describe('pin', () => {
  it('ghim Superpowers 6.4.1 đúng bản owner cài', () => {
    expect(SUPERPOWERS_PIN).toEqual({
      workflow: 'superpowers',
      version: '6.4.1',
      revision: '5bf4e78011075bcfc0dc295f0724994cd123ee71',
      checksum: '3f0ff8c82c0795dae8de3cc3ef358364d4f3de81e78b86e1d64b03ac2f9cbd9a',
    });
    expect(superpowersPinDir('/Users/a')).toBe('/Users/a/.crew/workflows/superpowers/6.4.1-5bf4e7801107');
    expect(agentExtraArgs('/p')).toEqual(['--setting-sources', 'project,local', '--plugin-dir', '/p']);
  });

  it('assertSkillAllowed chỉ cho đúng pin', () => {
    expect(samePin(SUPERPOWERS_PIN, { ...SUPERPOWERS_PIN })).toBe(true);
    expect(() =>
      assertSkillAllowed(SUPERPOWERS_PIN, { ...SUPERPOWERS_PIN, checksum: '0'.repeat(64) }),
    ).toThrow('WORKFLOW_SOURCE_MISMATCH');
    expect(() => assertSkillAllowed(SUPERPOWERS_PIN, { ...SUPERPOWERS_PIN, version: '6.4.2' })).toThrow(
      'WORKFLOW_SOURCE_MISMATCH',
    );
  });
});

describe('readInstalledPlugins', () => {
  it('chưa có file hoặc file hỏng thì trả rỗng, bỏ entry thiếu trường', () => {
    const { home } = fakeMac({ ownerSuperpowers: false });
    expect(readInstalledPlugins(home, 'superpowers@claude-plugins-official')).toEqual([]);
    mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
    writeFileSync(installedPluginsFile(home), '{hỏng');
    expect(readInstalledPlugins(home, 'superpowers@claude-plugins-official')).toEqual([]);
    writeFileSync(
      installedPluginsFile(home),
      JSON.stringify({
        version: 2,
        plugins: {
          'superpowers@claude-plugins-official': [
            { installPath: '/x', version: '1.0.0' },
            { installPath: 42, version: '1.0.0' },
          ],
        },
      }),
    );
    expect(readInstalledPlugins(home, 'superpowers@claude-plugins-official')).toEqual([
      { installPath: '/x', version: '1.0.0', gitCommitSha: null },
    ]);
  });
});

describe('installSuperpowersPin', () => {
  it('copy bản owner đúng pin vào ~/.crew/workflows, bỏ .in_use, lần hai không đổi gì', () => {
    const { home, ctx } = fakeMac();
    const first = installSuperpowersPin(ctx, FIXTURE_PIN);
    expect(first).toEqual({
      dir: join(home, '.crew', 'workflows', 'superpowers', '9.9.9-ffffffffffff'),
      changed: true,
    });
    expect(treeChecksum(first.dir)).toEqual({ checksum: FIXTURE_PIN.checksum, files: 2 });
    expect(installSuperpowersPin(ctx, FIXTURE_PIN).changed).toBe(false);
  });

  it('mặc định dùng pin của context', () => {
    const { ctx } = fakeMac();
    expect(installSuperpowersPin(ctx).dir).toBe(superpowersPinDir(ctx.home, FIXTURE_PIN));
  });

  it('owner cài bản khác pin thì báo lỗi rõ, không tạo thư mục', () => {
    const { home, ctx } = fakeMac({ ownerSuperpowers: false });
    seedOwnerPlugin(home, '9.9.8', 'e'.repeat(40));
    expect(() => installSuperpowersPin(ctx, FIXTURE_PIN)).toThrow(/9\.9\.9/);
    expect(() => treeChecksum(superpowersPinDir(home, FIXTURE_PIN))).toThrow();
  });

  it('owner cài đúng bản nhưng cây bị sửa thì không cài', () => {
    const { home, ctx } = fakeMac({ ownerSuperpowers: false });
    const installPath = seedOwnerPlugin(home, '9.9.9', 'f'.repeat(40));
    writeFileSync(join(installPath, 'a.txt'), 'khác\n');
    expect(() => installSuperpowersPin(ctx, FIXTURE_PIN)).toThrow(/checksum/);
  });

  it('thư mục pin có sẵn mà lệch checksum thì từ chối ghi đè', () => {
    const { ctx } = fakeMac();
    const dir = installSuperpowersPin(ctx, FIXTURE_PIN).dir;
    writeFileSync(join(dir, 'a.txt'), 'bị sửa\n');
    expect(() => installSuperpowersPin(ctx, FIXTURE_PIN)).toThrow(/lệch checksum/);
  });

  it('bản tạm dở dang của lần trước không cản lần cài sau', () => {
    const { ctx } = fakeMac();
    const dir = superpowersPinDir(ctx.home, FIXTURE_PIN);
    mkdirSync(`${dir}.tmp-${process.pid}`, { recursive: true });
    writeFileSync(join(`${dir}.tmp-${process.pid}`, 'rác'), 'x');
    expect(installSuperpowersPin(ctx, FIXTURE_PIN).changed).toBe(true);
    expect(treeChecksum(dir).checksum).toBe(FIXTURE_PIN.checksum);
    rmSync(dir, { recursive: true });
  });
});
