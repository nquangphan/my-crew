import { existsSync, mkdirSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { workflowsCommand } from '../src/commands/workflows.js';
import { macPaths } from '../src/paths.js';
import { pinDir } from '../src/workflows/pin.js';
import {
  gcWorkflowPins,
  IN_USE_MAX_AGE_MS,
  WORKFLOW_GC_INTERVAL_MS,
  WORKFLOW_GC_RECENT_MS,
} from '../src/workflows/workflow-gc.js';
import { FIXTURE_BMAD_PIN, FIXTURE_PIN, fakeMac } from './helpers/fake-mac.js';

const HOUR = 3_600_000;
const UUID = '0b7f3c2e-7d1a-4c55-9a51-5d0e7a6b9c10';

function setup() {
  const mac = fakeMac();
  const root = macPaths(mac.home).workflowsRoot;
  const now = mac.ctx.now().getTime();
  /** Dựng thư mục ghim cũ; `ageMs` là tuổi mtime của thư mục, của `.in_use/` và của từng dấu. */
  const oldPin = (rel: string, ageMs: number, marks: Record<string, string> = {}) => {
    const dir = join(root, rel);
    mkdirSync(join(dir, '.in_use'), { recursive: true });
    writeFileSync(join(dir, 'a.txt'), 'x');
    for (const [id, body] of Object.entries(marks)) writeFileSync(join(dir, '.in_use', id), body);
    const at = new Date(now - ageMs);
    for (const id of Object.keys(marks)) utimesSync(join(dir, '.in_use', id), at, at);
    utimesSync(join(dir, '.in_use'), at, at);
    utimesSync(dir, at, at);
    return dir;
  };
  return { mac, root, now, oldPin };
}

describe('gcWorkflowPins', () => {
  it('thư mục hiện hành của cả hai workflow luôn được giữ, kể cả không có .in_use', () => {
    const { mac } = setup();
    mkdirSync(pinDir(mac.home, FIXTURE_PIN), { recursive: true });
    const report = gcWorkflowPins(mac.ctx, { isAlive: () => false });
    expect(report.removed).toEqual([]);
    expect(report.kept).toEqual(
      expect.arrayContaining([
        { dir: pinDir(mac.home, FIXTURE_PIN), reason: 'current' },
        { dir: pinDir(mac.home, FIXTURE_BMAD_PIN), reason: 'current' },
      ]),
    );
    expect(existsSync(pinDir(mac.home, FIXTURE_BMAD_PIN))).toBe(true);
  });

  it('bản cũ còn dấu .in_use của pid sống thì giữ (in_use)', () => {
    const { mac, now, oldPin } = setup();
    const dir = oldPin('bmad/6.12.0-aaaaaaaaaaaa', 48 * HOUR, {
      [UUID]: `4242 ${Math.floor(now / 1000) - 60}\n`,
    });
    const report = gcWorkflowPins(mac.ctx, { isAlive: (pid) => pid === 4242 });
    expect(report.kept).toContainEqual({ dir, reason: 'in_use' });
    expect(existsSync(join(dir, '.in_use', UUID))).toBe(true);
  });

  it('pid chết và thư mục không đổi 25 giờ thì xóa dấu rồi xóa thư mục', () => {
    const { mac, oldPin } = setup();
    const dir = oldPin('bmad/6.12.0-aaaaaaaaaaaa', 25 * HOUR, { [UUID]: '4242 1760000000\n' });
    const report = gcWorkflowPins(mac.ctx, { isAlive: () => false });
    expect(report.removed).toEqual([dir]);
    expect(existsSync(dir)).toBe(false);
  });

  it('pid chết nhưng thư mục đổi trong 24 giờ thì xóa dấu, giữ thư mục (recent)', () => {
    const { mac, oldPin } = setup();
    const dir = oldPin('superpowers/6.3.0-aaaaaaaaaaaa', 2 * HOUR, { [UUID]: '4242 1760000000\n' });
    const report = gcWorkflowPins(mac.ctx, { isAlive: () => false });
    expect(report.removed).toEqual([]);
    expect(report.kept).toContainEqual({ dir, reason: 'recent' });
    expect(existsSync(join(dir, '.in_use', UUID))).toBe(false);
  });

  it('dấu không parse được coi như sống tới khi cũ hơn 7 ngày thì xóa dấu', () => {
    const { mac, now, oldPin } = setup();
    const dir = oldPin('bmad/6.12.0-aaaaaaaaaaaa', 30 * HOUR, { [UUID]: 'abc' });
    const first = gcWorkflowPins(mac.ctx, { isAlive: () => false });
    expect(first.kept).toContainEqual({ dir, reason: 'in_use' });
    expect(existsSync(join(dir, '.in_use', UUID))).toBe(true);

    const old = new Date(now - IN_USE_MAX_AGE_MS - HOUR);
    utimesSync(join(dir, '.in_use', UUID), old, old);
    const second = gcWorkflowPins(mac.ctx, { isAlive: () => false });
    expect(second.removed).toEqual([dir]);
    expect(existsSync(dir)).toBe(false);
  });

  it('dấu hợp lệ cũ hơn 7 ngày bị xóa kể cả khi pid còn sống (pid đã cấp lại cho process khác)', async () => {
    const { mac, oldPin } = setup();
    const dir = oldPin('bmad/6.12.0-aaaaaaaaaaaa', IN_USE_MAX_AGE_MS + HOUR, { [UUID]: '4242 1760000000\n' });
    const report = gcWorkflowPins(mac.ctx, { isAlive: () => true });
    expect(report.removed).toEqual([dir]);
    expect(existsSync(dir)).toBe(false);
  });

  it('run vừa kết thúc (dấu ghi 2 giờ trước, thư mục ghim 48 giờ) thì giữ (recent) và xóa dấu', async () => {
    const { mac, now, oldPin } = setup();
    const dir = oldPin('bmad/6.12.0-aaaaaaaaaaaa', 48 * HOUR, { [UUID]: '4242 1760000000\n' });
    const recent = new Date(now - 2 * HOUR);
    utimesSync(join(dir, '.in_use', UUID), recent, recent);
    utimesSync(join(dir, '.in_use'), recent, recent);
    const report = gcWorkflowPins(mac.ctx, { isAlive: () => false });
    expect(report.kept).toContainEqual({ dir, reason: 'recent' });
    expect(existsSync(join(dir, '.in_use', UUID))).toBe(false);
  });

  it('không đụng thư mục *.tmp-* và thư mục lạ không theo mẫu <version>-<12 hex>', () => {
    const { mac, root, oldPin } = setup();
    const tmp = oldPin('bmad/6.12.0-aaaaaaaaaaaa.tmp-123', 48 * HOUR);
    const odd = oldPin('bmad/ban-cua-owner', 48 * HOUR);
    const short = oldPin('superpowers/6.3.0-abc', 48 * HOUR);
    const report = gcWorkflowPins(mac.ctx, { isAlive: () => false });
    expect(report.removed).toEqual([]);
    for (const dir of [tmp, odd, short]) expect(existsSync(dir)).toBe(true);
    expect(existsSync(root)).toBe(true);
  });

  it('không theo symlink: liên kết tên đúng mẫu bị bỏ qua, đích không bị xóa', () => {
    const { mac, root, now } = setup();
    const target = join(mac.home, 'ngoai');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'giu.txt'), 'x');
    const old = new Date(now - 48 * HOUR);
    utimesSync(target, old, old);
    symlinkSync(target, join(root, 'bmad', '6.12.0-aaaaaaaaaaaa'));
    const report = gcWorkflowPins(mac.ctx, { isAlive: () => false });
    expect(report.removed).toEqual([]);
    expect(existsSync(join(target, 'giu.txt'))).toBe(true);
  });

  it('chạy hai lần liên tiếp không lỗi, lần hai không còn gì để xóa', () => {
    const { mac, oldPin } = setup();
    const dir = oldPin('bmad/6.12.0-aaaaaaaaaaaa', 25 * HOUR);
    expect(gcWorkflowPins(mac.ctx, { isAlive: () => false }).removed).toEqual([dir]);
    expect(gcWorkflowPins(mac.ctx, { isAlive: () => false }).removed).toEqual([]);
  });

  it('chưa có thư mục workflows thì trả báo cáo rỗng ở các thư mục không tồn tại', () => {
    const mac = fakeMac({ bmadInstalled: false, ownerSuperpowers: false });
    expect(gcWorkflowPins(mac.ctx, { isAlive: () => false }).removed).toEqual([]);
  });

  it('isAlive mặc định: pid của chính process này sống, pid không tồn tại thì chết', () => {
    const { mac, now, oldPin } = setup();
    const dir = oldPin('bmad/6.12.0-aaaaaaaaaaaa', 48 * HOUR, { a: `${process.pid} 1760000000\n` });
    expect(gcWorkflowPins(mac.ctx).kept).toContainEqual({ dir, reason: 'in_use' });
    writeFileSync(join(dir, '.in_use', 'a'), '2147483000 1760000000\n');
    const old = new Date(now - 48 * HOUR);
    utimesSync(join(dir, '.in_use', 'a'), old, old);
    expect(gcWorkflowPins(mac.ctx).removed).toEqual([dir]);
  });

  it('hằng số theo plan', () => {
    expect(WORKFLOW_GC_INTERVAL_MS).toBe(HOUR);
    expect(WORKFLOW_GC_RECENT_MS).toBe(24 * HOUR);
    expect(IN_USE_MAX_AGE_MS).toBe(7 * 24 * HOUR);
  });
});

describe('crew-mac workflows gc', () => {
  it('in "Đã dọn: <n> bản ghim cũ" và từng thư mục, thoát 0', async () => {
    const { mac, oldPin } = setup();
    const dir = oldPin('bmad/6.12.0-aaaaaaaaaaaa', 48 * HOUR);
    const out: string[] = [];
    mac.ctx.out = (l) => out.push(l);
    expect(await workflowsCommand(mac.ctx, ['gc'])).toBe(0);
    expect(out).toEqual(['Đã dọn: 1 bản ghim cũ', `  ${dir}`]);
    out.length = 0;
    expect(await workflowsCommand(mac.ctx, ['gc'])).toBe(0);
    expect(out).toEqual(['Đã dọn: 0 bản ghim cũ']);
  });

  it('gc nhận thừa đối số thì thoát 2', async () => {
    const { mac } = setup();
    expect(await workflowsCommand(mac.ctx, ['gc', '--x'], () => {})).toBe(2);
  });

  it('install dọn bản cũ sau khi cài và in "Đã dọn" khi có gì bị xóa', async () => {
    const { mac, oldPin } = setup();
    const dir = oldPin('superpowers/6.3.0-aaaaaaaaaaaa', 48 * HOUR);
    const out: string[] = [];
    mac.ctx.out = (l) => out.push(l);
    expect(await workflowsCommand(mac.ctx, ['install'])).toBe(0);
    expect(existsSync(dir)).toBe(false);
    expect(out.slice(-2)).toEqual(['Đã dọn: 1 bản ghim cũ', `  ${dir}`]);
  });
});
