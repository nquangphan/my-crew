import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SetupError } from '../src/context.js';
import { installBmadPin } from '../src/workflows/bmad-install.js';
import { BMAD_PLUGIN_JSON, BMAD_SOURCE } from '../src/workflows/bmad-pin.js';
import { pinDir } from '../src/workflows/pin.js';
import { treeChecksum } from '../src/workflows/tree-checksum.js';
import {
  fakeMac,
  fixtureBmadPin,
  gitIn,
  passThroughGitTar,
  seedBmadMarketplace,
} from './helpers/fake-mac.js';

/** Mac giả chưa có bản ghim BMAD, git/tar chạy thật qua FakeRunner (vẫn đếm được lời gọi). */
function bmadMac() {
  const mac = fakeMac({ bmadInstalled: false });
  passThroughGitTar(mac.runner);
  return mac;
}

function listTree(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: 'utf8' }).sort();
}

function leftovers(dir: string): string[] {
  return readdirSync(dirname(dir)).filter((e) => e.includes('.tmp-'));
}

const gitCalls = (mac: ReturnType<typeof fakeMac>) =>
  mac.runner.calls.filter((c) => c.command === '/usr/bin/git');

describe('installBmadPin', () => {
  it('lắp bản ghim từ marketplace local: đúng checksum, plugin.json, bit x, không rác, không ghi vào ~/.claude', async () => {
    const mac = bmadMac();
    const { revision } = seedBmadMarketplace(mac.home);
    mac.ctx.bmadPin = fixtureBmadPin(revision);
    const before = listTree(join(mac.home, '.claude'));
    const result = await installBmadPin(mac.ctx);
    const dir = pinDir(mac.home, mac.ctx.bmadPin);
    expect(result).toEqual({ dir, source: 'marketplace' });
    expect(treeChecksum(dir)).toEqual({ checksum: mac.ctx.bmadPin.checksum, files: 3 });
    expect(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).toBe(BMAD_PLUGIN_JSON);
    expect(statSync(join(dir, 'skills', 'bmad', 'scripts', 'setup.py')).mode & 0o111).not.toBe(0);
    expect(leftovers(dir)).toEqual([]);
    expect(listTree(join(mac.home, '.claude'))).toEqual(before);
    expect(mac.runner.commands()).toContain(
      `/usr/bin/git -C ${join(mac.home, '.claude/plugins/marketplaces/bmad')} cat-file -e ${revision}^{commit}`,
    );
  });

  it('lần hai dùng bản có sẵn, không gọi git', async () => {
    const mac = bmadMac();
    mac.ctx.bmadPin = fixtureBmadPin(seedBmadMarketplace(mac.home).revision);
    await installBmadPin(mac.ctx);
    const calls = gitCalls(mac).length;
    expect(await installBmadPin(mac.ctx)).toEqual({
      dir: pinDir(mac.home, mac.ctx.bmadPin),
      source: 'existing',
    });
    expect(gitCalls(mac).length).toBe(calls);
  });

  it('marketplace đã sang commit mới: vẫn lấy đúng cây của revision ghim', async () => {
    const mac = bmadMac();
    const { dir: market, revision } = seedBmadMarketplace(mac.home);
    writeFileSync(join(market, 'plugins', 'method', 'skills', 'm1', 'SKILL.md'), 'đổi ở HEAD\n');
    gitIn(market, 'commit', '-q', '-am', 'next');
    mac.ctx.bmadPin = fixtureBmadPin(revision);
    const { dir, source } = await installBmadPin(mac.ctx);
    expect(source).toBe('marketplace');
    expect(treeChecksum(dir).checksum).toBe(mac.ctx.bmadPin.checksum);
  });

  it('không có marketplace: clone --filter=blob:none --no-checkout từ repoUrl', async () => {
    const upstream = mkdtempSync(join(tmpdir(), 'crew-bmad-upstream-'));
    const mac = bmadMac();
    const { revision } = seedBmadMarketplace(mac.home, { dir: upstream });
    mac.ctx.bmadPin = fixtureBmadPin(revision);
    const result = await installBmadPin(mac.ctx, { ...BMAD_SOURCE, repoUrl: upstream });
    expect(result.source).toBe('github');
    expect(treeChecksum(result.dir).checksum).toBe(mac.ctx.bmadPin.checksum);
    const clone = mac.runner.calls.find((c) => c.args.includes('clone'));
    expect(clone?.args.slice(0, 4)).toEqual(['clone', '--filter=blob:none', '--no-checkout', upstream]);
    expect(clone?.options.timeoutMs).toBe(120_000);
    expect(leftovers(result.dir)).toEqual([]);
    expect(existsSync(join(mac.home, '.claude', 'plugins', 'marketplaces'))).toBe(false);
  });

  it('hai cây trùng tên skill: SetupError, không để lại thư mục ghim hay bản tạm', async () => {
    const mac = bmadMac();
    mac.ctx.bmadPin = fixtureBmadPin(seedBmadMarketplace(mac.home, { duplicate: true }).revision);
    const err = await installBmadPin(mac.ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SetupError);
    expect((err as Error).message).toBe('tên skill trùng giữa bmad-method và bmad-toolbox: m1');
    const dir = pinDir(mac.home, mac.ctx.bmadPin);
    expect(existsSync(dir)).toBe(false);
    expect(leftovers(dir)).toEqual([]);
  });

  it('thư mục ghim có sẵn mà lệch checksum: WORKFLOW_SOURCE_MISMATCH, không ghi đè', async () => {
    const mac = bmadMac();
    mac.ctx.bmadPin = fixtureBmadPin(seedBmadMarketplace(mac.home).revision);
    const { dir } = await installBmadPin(mac.ctx);
    const skill = join(dir, 'skills', 'm1', 'SKILL.md');
    writeFileSync(skill, 'bị sửa\n');
    await expect(installBmadPin(mac.ctx)).rejects.toThrow(/WORKFLOW_SOURCE_MISMATCH/);
    expect(readFileSync(skill, 'utf8')).toBe('bị sửa\n');
  });

  it('bản tạm của lần trước (pid khác) bị xóa trước khi cài', async () => {
    const mac = bmadMac();
    mac.ctx.bmadPin = fixtureBmadPin(seedBmadMarketplace(mac.home).revision);
    const dir = pinDir(mac.home, mac.ctx.bmadPin);
    const stale = `${dir}.tmp-99999`;
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, 'rác'), 'x');
    await installBmadPin(mac.ctx);
    expect(existsSync(stale)).toBe(false);
    expect(treeChecksum(dir).checksum).toBe(mac.ctx.bmadPin.checksum);
  });

  it('marketplace thiếu revision và clone lỗi: SetupError cố định', async () => {
    const mac = bmadMac();
    seedBmadMarketplace(mac.home);
    mac.ctx.bmadPin = fixtureBmadPin('a'.repeat(40));
    const err = await installBmadPin(mac.ctx, {
      ...BMAD_SOURCE,
      repoUrl: join(mac.home, 'khong-co-repo'),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SetupError);
    expect((err as Error).message).toBe(
      'không lấy được BMAD 9.9.9-next (aaaaaaaaaaaa): cần mạng tới github.com hoặc marketplace bmad có commit này',
    );
    const dir = pinDir(mac.home, mac.ctx.bmadPin);
    expect(existsSync(dir)).toBe(false);
    expect(leftovers(dir)).toEqual([]);
  });

  it('cây tải về lệch checksum pin: không cài', async () => {
    const mac = bmadMac();
    const { revision } = seedBmadMarketplace(mac.home);
    mac.ctx.bmadPin = { ...fixtureBmadPin(revision), checksum: '0'.repeat(64) };
    await expect(installBmadPin(mac.ctx)).rejects.toThrow(/WORKFLOW_SOURCE_MISMATCH/);
    const dir = pinDir(mac.home, mac.ctx.bmadPin);
    expect(existsSync(dir)).toBe(false);
    expect(leftovers(dir)).toEqual([]);
  });
});
