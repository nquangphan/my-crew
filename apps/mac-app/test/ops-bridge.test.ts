import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { type UtilityLike, UtilityOpsBridge } from '../src/main/ops-bridge.js';
import { createOpsHandlers, type OpsRequest } from '../src/utility/ops.js';

class FakeChild extends EventEmitter implements UtilityLike {
  sent: OpsRequest[] = [];
  postMessage(message: OpsRequest) {
    this.sent.push(message);
  }
  kill() {
    this.emit('exit', 0);
  }
  reply(id: number, result: unknown) {
    this.emit('message', { id, ok: true, result });
  }
}

describe('UtilityOpsBridge', () => {
  it('gửi {id, op, args} và nhận kết quả', async () => {
    const child = new FakeChild();
    const bridge = new UtilityOpsBridge(() => child);
    const pending = bridge.call('listStatusRepos');
    expect(child.sent).toHaveLength(1);
    expect(child.sent[0]).toMatchObject({ op: 'listStatusRepos', args: [] });
    child.reply(child.sent[0]?.id as number, [{ projectId: 'p' }]);
    await expect(pending).resolves.toEqual([{ projectId: 'p' }]);
  });

  it('hai lời gọi song song nhận đúng kết quả theo id', async () => {
    const child = new FakeChild();
    const bridge = new UtilityOpsBridge(() => child);
    const a = bridge.call('configureStatus', 'http://a', 'c1');
    const b = bridge.call('listStatusRepos');
    const [first, second] = child.sent as [OpsRequest, OpsRequest];
    child.reply(second.id, 'B');
    child.reply(first.id, 'A');
    await expect(a).resolves.toBe('A');
    await expect(b).resolves.toBe('B');
  });

  it('utility chết giữa chừng thì reject, lần gọi sau tự fork lại', async () => {
    const children: FakeChild[] = [];
    const fork = vi.fn(() => {
      const child = new FakeChild();
      children.push(child);
      return child;
    });
    const bridge = new UtilityOpsBridge(fork);
    const pending = bridge.call('listStatusRepos');
    children[0]?.emit('exit', 1);
    await expect(pending).rejects.toThrow('Tiến trình phụ dừng bất thường');
    const next = bridge.call('listStatusRepos');
    expect(fork).toHaveBeenCalledTimes(2);
    children[1]?.reply(children[1].sent[0]?.id as number, []);
    await expect(next).resolves.toEqual([]);
  });

  it('lỗi từ utility được ném lại với cùng name và message', async () => {
    const child = new FakeChild();
    const bridge = new UtilityOpsBridge(() => child);
    const pending = bridge.call('doctor', { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    child.emit('message', {
      id: child.sent[0]?.id,
      ok: false,
      error: { name: 'SetupError', message: 'Từ chối' },
    });
    await expect(pending).rejects.toMatchObject({ name: 'SetupError', message: 'Từ chối' });
  });

  it('dispose giết utility và reject lời gọi đang chờ', async () => {
    const child = new FakeChild();
    const bridge = new UtilityOpsBridge(() => child);
    const pending = bridge.call('listStatusRepos');
    bridge.dispose();
    await expect(pending).rejects.toThrow('Tiến trình phụ dừng bất thường');
  });
});

describe('createOpsHandlers (utility)', () => {
  it('gọi @crew/mac thật với HOME giả, không đụng ~/.crew thật', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const home = mkdtempSync(join(tmpdir(), 'ops-home-'));
    const lines: string[] = [];
    const handlers = createOpsHandlers({ env: { HOME: home }, log: (line) => lines.push(line) });
    await expect(handlers.listStatusRepos()).resolves.toEqual([]);
  });

  it('jobTargets đọc máy và đích từ status.json; runMachineJob kiểm payload trước khi làm', async () => {
    const { mkdirSync, mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const home = mkdtempSync(join(tmpdir(), 'ops-home-'));
    const handlers = createOpsHandlers({ env: { HOME: home }, log: () => undefined });
    await expect(handlers.jobTargets()).resolves.toEqual({ machineId: null, targets: [] });
    const company = '11111111-1111-4111-8111-111111111111';
    const machine = '55555555-5555-4555-8555-555555555555';
    mkdirSync(join(home, '.crew'), { recursive: true });
    writeFileSync(
      join(home, '.crew', 'status.json'),
      JSON.stringify({ url: 'https://crew.example.com', companyId: company, machineId: machine }),
    );
    await expect(handlers.jobTargets()).resolves.toEqual({
      machineId: machine,
      targets: [{ url: 'https://crew.example.com', companyId: company }],
    });
    const job = {
      id: '66666666-6666-4666-8666-666666666666',
      companyId: company,
      machineId: machine,
      kind: 'check',
      payload: { kind: 'check', projectKey: 'Sai Khoa' },
    } as unknown as Parameters<typeof handlers.runMachineJob>[0];
    await expect(handlers.runMachineJob(job, { projectId: null })).resolves.toEqual({
      status: 'failed',
      errorCode: 'app_error',
      errorText: 'Việc không hợp lệ: projectKey không hợp lệ',
    });
  });

  it('ctx dùng cliPath cài đặt dưới HOME', async () => {
    const seen: string[] = [];
    const handlers = createOpsHandlers({
      env: { HOME: '/tmp/fake-home' },
      log: () => undefined,
      makeContext: (input) => {
        seen.push(input.cliPath);
        throw new Error('dừng');
      },
    });
    await expect(handlers.listStatusRepos()).rejects.toThrow('dừng');
    expect(seen).toEqual(['/tmp/fake-home/.crew/app/crew-mac/dist/cli.js']);
  });
});
