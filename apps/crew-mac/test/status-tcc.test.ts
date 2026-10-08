import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakeMac } from './helpers/fake-mac.js';
import { updateTccPending, probeStatusTcc } from '../src/status/tcc.js';

const prompt = (id: string, service: string, client: string, at: string) =>
  `${at} Df tccd[1:1] [com.apple.TCC:access] AUTHREQ_PROMPTING: msgID=${id}, service=${service}, subject=Sub:{${client}}Resp:{TCCDProcess: identifier=com.example.client, pid=9}`;

describe('status TCC nối tiếp', () => {
  it('thêm prompt chưa có result và gỡ prompt đã có result', () => {
    const pending = updateTccPending([], [
      prompt('1.1', 'kTCCServiceDesktop', '/Applications/A.app', '2026-10-08 10:00:00.000'),
      '2026-10-08 10:00:01.000 Df tccd[1:1] [com.apple.TCC:access] AUTHREQ_RESULT: msgID=1.1, authValue=0',
      prompt('2.2', 'kTCCServiceDocuments', '/Applications/B.app', '2026-10-08 10:00:02.000'),
    ]);
    expect(pending).toEqual([
      expect.objectContaining({ service: 'kTCCServiceDocuments', client: '/Applications/B.app', msgId: '2.2' }),
    ]);
  });

  it('giữ nhiều client đang chờ và khớp result đến ở lần quét kế tiếp', () => {
    const first = updateTccPending([], [
      prompt('1.1', 'kTCCServiceDesktop', '/Applications/A.app', '2026-10-08 10:00:00.000'),
      prompt('2.2', 'kTCCServiceDocuments', '/Applications/B.app', '2026-10-08 10:00:01.000'),
    ]);
    expect(updateTccPending(first, ['2026-10-08 10:00:02.000 AUTHREQ_RESULT: msgID=1.1, authValue=0'])).toEqual([
      expect.objectContaining({ service: 'kTCCServiceDocuments', client: '/Applications/B.app', msgId: '2.2' }),
    ]);
  });

  it('lần đầu quét 24 giờ, lần kế tiếp quét từ checkpoint trừ 5 giây', async () => {
    const { ctx, runner, home } = fakeMac();
    const commands: string[][] = [];
    runner.on('/usr/bin/log', (args) => {
      commands.push([...args]);
      return {};
    });
    await probeStatusTcc(ctx);
    await probeStatusTcc(ctx);
    expect(commands[0]).toContain('--last');
    expect(commands[0]).toContain('24h');
    expect(commands[1]).toContain('--start');
    expect(commands[1]).toContain('2026-10-06 13:59:55+0700');
    const state = JSON.parse(readFileSync(join(home, '.crew', 'status-tcc.json'), 'utf8'));
    expect(state.scannedUntil).toBe('2026-10-06T07:00:00.000Z');
    expect(statSync(join(home, '.crew', 'status-tcc.json')).mode & 0o777).toBe(0o600);
  });

  it('timeout giữ nguyên checkpoint và pending, đồng thời trả cảnh báo', async () => {
    const { ctx, runner, home } = fakeMac();
    const path = join(home, '.crew', 'status-tcc.json');
    mkdirSync(join(home, '.crew'), { recursive: true });
    const saved = {
      scannedUntil: '2026-10-06T06:00:00.000Z',
      pending: [{ service: 'kTCCServiceDesktop', client: '/Applications/A.app', since: '2026-10-06T05:00:00.000Z', msgId: '1.1' }],
    };
    writeFileSync(path, JSON.stringify(saved), { mode: 0o600 });
    runner.on('/usr/bin/log', () => ({ code: 137, timedOut: true }));
    const result = await probeStatusTcc(ctx);
    expect(result.pending).toEqual(saved.pending);
    expect(result.check).toEqual({ id: 'tcc-probe', status: 'warn', title: 'Không đọc kịp log TCC' });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(saved);
    expect(runner.calls.find((c) => c.command === '/usr/bin/log')?.options?.timeoutMs).toBe(20_000);
  });
});
