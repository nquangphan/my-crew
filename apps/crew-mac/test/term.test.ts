import { describe, expect, it } from 'vitest';
import { main, USAGE } from '../src/cli.js';
import { term } from '../src/commands/term.js';
import { UsageError } from '../src/context.js';
import { fakeMac } from './helpers/fake-mac.js';

const TMUX = '/opt/homebrew/bin/tmux';

describe('crew-mac term', () => {
  it('gắn vào phiên crew-owner-<key> trên socket crew, trả mã thoát', async () => {
    const mac = fakeMac();
    mac.runner.on(TMUX, (args) => (args.includes('attach') ? { code: 3 } : {}));
    expect(await term(mac.ctx, 'kidy-school')).toBe(3);
    const attach = mac.runner.calls.find((c) => c.args.includes('attach'));
    expect(attach?.command).toBe(TMUX);
    expect(attach?.args).toEqual(['-L', 'crew', 'attach', '-t', 'crew-owner-kidy-school']);
    expect(attach?.options.stdio).toBe('inherit');
  });

  it('phiên thứ n (n ≥ 2) là crew-owner-<key>_<n>; n = 1 giữ tên cũ', async () => {
    const mac = fakeMac();
    mac.runner.on(TMUX, () => ({}));
    expect(await term(mac.ctx, 'kidy-school', '2')).toBe(0);
    expect(mac.runner.calls.find((c) => c.args.includes('attach'))?.args).toEqual([
      '-L',
      'crew',
      'attach',
      '-t',
      'crew-owner-kidy-school_2',
    ]);
    const one = fakeMac();
    one.runner.on(TMUX, () => ({}));
    await term(one.ctx, 'kidy-school', '1');
    expect(one.runner.calls.find((c) => c.args.includes('attach'))?.args.at(-1)).toBe(
      'crew-owner-kidy-school',
    );
  });

  it('số phiên ngoài 1–9 thì UsageError', async () => {
    const mac = fakeMac();
    for (const n of ['0', '10', 'x', '2a']) {
      await expect(term(mac.ctx, 'kidy-school', n)).rejects.toBeInstanceOf(UsageError);
    }
    expect(mac.runner.calls).toEqual([]);
  });

  it('main term <key> <n> chuyển số phiên; thừa tham số thì USAGE', async () => {
    const mac = fakeMac();
    mac.runner.on(TMUX, () => ({}));
    const io = { out: () => {}, err: () => {}, env: {}, context: mac.ctx };
    expect(await main(['term', 'kidy-school', '3'], io)).toBe(0);
    expect(mac.runner.calls.find((c) => c.args.includes('attach'))?.args.at(-1)).toBe(
      'crew-owner-kidy-school_3',
    );
    expect(await main(['term', 'kidy-school', '3', 'x'], io)).toBe(2);
  });

  it('chưa có phiên thì báo, không attach', async () => {
    const mac = fakeMac();
    mac.runner.on(TMUX, (args) => (args.includes('has-session') ? { code: 1 } : {}));
    expect(await term(mac.ctx, 'kidy-school')).toBe(1);
    expect(mac.out).toEqual([
      'Chưa có phiên terminal của kidy-school. Mở terminal dự án trên web Crew trước.',
    ]);
    expect(mac.runner.calls.some((c) => c.args.includes('attach'))).toBe(false);
  });

  it('key sai thì ném UsageError, không chạy gì', async () => {
    const mac = fakeMac();
    await expect(term(mac.ctx, 'Bad;key')).rejects.toBeInstanceOf(UsageError);
    expect(mac.runner.calls).toEqual([]);
  });

  it('main term không có key thì ra USAGE, mã 2', async () => {
    const mac = fakeMac();
    const err: string[] = [];
    const code = await main(['term'], { out: () => {}, err: (l) => err.push(l), env: {}, context: mac.ctx });
    expect(code).toBe(2);
    expect(err.join('\n')).toContain(USAGE);
  });
});
