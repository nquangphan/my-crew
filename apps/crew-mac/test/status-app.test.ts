import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { macPaths } from '../src/paths.js';
import { readAppState, readJobsAgent } from '../src/status/app-state.js';
import { buildMachineReport } from '../src/status/report.js';
import { superpowersPinDir } from '../src/workflows/pin.js';
import { fakeMac, gitIn } from './helpers/fake-mac.js';

const dir = mkdtempSync(join(tmpdir(), 'app-state-'));
const file = (name: string, body: string) => {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
};
const state = (patch: Record<string, unknown>) =>
  JSON.stringify({ version: 1, appVersion: '0.1.0', sshdOwner: 'app', updateState: 'idle', ...patch });

describe('readAppState', () => {
  it('đọc đúng ba trường', () => {
    const p = file('ok.json', state({ sshdPid: 9 }));
    expect(readAppState(p)).toEqual({ version: '0.1.0', sshdOwner: 'app', updateState: 'idle' });
  });

  it('chấp nhận bản tiền phát hành và mọi updateState', () => {
    for (const updateState of [
      'idle',
      'downloading',
      'waiting-idle',
      'installing',
      'probation',
      'rolled-back',
    ]) {
      const p = file(`s-${updateState}.json`, state({ appVersion: '1.2.3-beta.1', updateState }));
      expect(readAppState(p)).toEqual({ version: '1.2.3-beta.1', sshdOwner: 'app', updateState });
    }
  });

  it('thiếu file, JSON hỏng, giá trị lạ thì null và không ném', () => {
    expect(readAppState(join(dir, 'none.json'))).toBeNull();
    expect(readAppState(file('bad.json', '{'))).toBeNull();
    expect(readAppState(file('arr.json', '[]'))).toBeNull();
    expect(readAppState(file('owner.json', state({ sshdOwner: 'x' })))).toBeNull();
    expect(readAppState(file('upd.json', state({ updateState: 'x' })))).toBeNull();
    expect(readAppState(file('ver.json', state({ appVersion: 'abc' })))).toBeNull();
    expect(readAppState(file('num.json', state({ appVersion: 1 })))).toBeNull();
    expect(readAppState(file('long.json', state({ appVersion: `1.0.0-${'x'.repeat(30)}` })))).toBeNull();
  });
});

describe('bản tin máy có trường app', () => {
  const company = '22222222-2222-4222-8222-222222222222';
  const machine = '11111111-1111-4111-8111-111111111111';
  const setup = () => {
    const m = fakeMac({ ownerSuperpowers: false });
    m.runner.on('/usr/sbin/sysctl', () => ({ code: 1 }));
    m.runner.on('/usr/bin/memory_pressure', () => ({ code: 1 }));
    m.runner.on('/usr/bin/log', () => ({ stdout: '' }));
    m.runner.on('claude', () => ({ code: 127 }));
    return m;
  };

  it('có app.json hợp lệ thì bản tin mang app', async () => {
    const { ctx, home } = setup();
    const p = macPaths(home).appState;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, state({ appVersion: '0.2.0', sshdOwner: 'launchd', updateState: 'probation' }));
    const report = await buildMachineReport(ctx, company, machine);
    expect(report.app).toEqual({ version: '0.2.0', sshdOwner: 'launchd', updateState: 'probation' });
  });

  it('không có app.json thì bản tin không có key app', async () => {
    const { ctx, home } = setup();
    expect(macPaths(home).appState).toBe(join(home, 'Library', 'Application Support', '2P Crew', 'app.json'));
    const report = await buildMachineReport(ctx, company, machine);
    expect('app' in report).toBe(false);
  });

  it('app.json hỏng thì bản tin không có key app', async () => {
    const { ctx, home } = setup();
    const p = macPaths(home).appState;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, '{');
    const report = await buildMachineReport(ctx, company, machine);
    expect('app' in report).toBe(false);
  });
});

describe('readJobsAgent', () => {
  it('đọc jobsAgent độc lập với ba trường app', () => {
    const p = file(
      'jobs.json',
      state({ jobsAgent: { version: '0.3.0', lastPollAt: '2026-10-10T03:00:00.000Z' } }),
    );
    expect(readJobsAgent(p)).toEqual({ version: '0.3.0', lastPollAt: '2026-10-10T03:00:00.000Z' });
    const broken = file(
      'jobs-only.json',
      JSON.stringify({ jobsAgent: { version: '0.3.0', lastPollAt: '2026-10-10T03:00:00Z' } }),
    );
    expect(readJobsAgent(broken)).toEqual({ version: '0.3.0', lastPollAt: '2026-10-10T03:00:00Z' });
  });

  it('thiếu hoặc sai dạng thì null', () => {
    expect(readJobsAgent(join(dir, 'none.json'))).toBeNull();
    expect(readJobsAgent(file('j0.json', state({})))).toBeNull();
    expect(
      readJobsAgent(
        file('j1.json', state({ jobsAgent: { version: 'x', lastPollAt: '2026-10-10T03:00:00Z' } })),
      ),
    ).toBeNull();
    expect(
      readJobsAgent(file('j2.json', state({ jobsAgent: { version: '0.3.0', lastPollAt: 'hôm qua' } }))),
    ).toBeNull();
    expect(readJobsAgent(file('j3.json', state({ jobsAgent: { version: '0.3.0' } })))).toBeNull();
    expect(readJobsAgent(file('j4.json', state({ jobsAgent: [] })))).toBeNull();
  });
});

describe('bản tin máy có checkout, skill Superpowers và jobsAgent', () => {
  const company = '22222222-2222-4222-8222-222222222222';
  const machine = '11111111-1111-4111-8111-111111111111';
  const setup = (ownerSuperpowers = false) => {
    const m = fakeMac({ ownerSuperpowers });
    m.runner.on('/usr/sbin/sysctl', () => ({ code: 1 }));
    m.runner.on('/usr/bin/memory_pressure', () => ({ code: 1 }));
    m.runner.on('/usr/bin/log', () => ({ stdout: '' }));
    m.runner.on('claude', () => ({ code: 127 }));
    return m;
  };

  it('app.json có jobsAgent thì bản tin mang jobsAgent, kể cả khi ba trường app hỏng', async () => {
    const { ctx, home } = setup();
    const p = macPaths(home).appState;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(
      p,
      JSON.stringify({
        sshdOwner: 'x',
        jobsAgent: { version: '0.3.0', lastPollAt: '2026-10-10T03:00:00.000Z' },
      }),
    );
    const report = await buildMachineReport(ctx, company, machine);
    expect(report.jobsAgent).toEqual({ version: '0.3.0', lastPollAt: '2026-10-10T03:00:00.000Z' });
    expect('app' in report).toBe(false);
  });

  it('không có jobsAgent thì bản tin không có key jobsAgent', async () => {
    const { ctx } = setup();
    const report = await buildMachineReport(ctx, company, machine);
    expect('jobsAgent' in report).toBe(false);
  });

  it('bản ghim Superpowers có skill thì báo tên skill (sắp xếp) và pinDir tuyệt đối', async () => {
    const { ctx, home } = setup();
    const pin = superpowersPinDir(home, ctx.superpowersPin);
    for (const name of ['writing-plans', 'brainstorming'])
      mkdirSync(join(pin, 'skills', name), { recursive: true });
    writeFileSync(join(pin, 'skills', 'brainstorming', 'SKILL.md'), '---\nname: brainstorming\n---\n');
    writeFileSync(join(pin, 'skills', 'writing-plans', 'SKILL.md'), '---\nname: writing-plans\n---\n');
    mkdirSync(join(pin, 'skills', 'no-skill-file'), { recursive: true });
    writeFileSync(join(pin, 'skills', 'README.md'), 'x');
    const report = await buildMachineReport(ctx, company, machine);
    expect(report.superpowers).toMatchObject({
      pinned: ctx.superpowersPin.version,
      pinDir: pin,
      skills: ['brainstorming', 'writing-plans'],
    });
  });

  it('chưa có bản ghim thì pinDir null và không có skills', async () => {
    const { ctx } = setup();
    const report = await buildMachineReport(ctx, company, machine);
    expect(report.superpowers).toEqual({ pinned: null, ownerInstalled: null, pinDir: null });
  });

  it('bản tin có checkouts từ ~/crew-agents', async () => {
    const { ctx, home } = setup();
    const dirPath = join(home, 'crew-agents', 'demo', 'assistant');
    mkdirSync(dirPath, { recursive: true });
    gitIn(dirPath, 'init', '-q', '-b', 'main');
    writeFileSync(join(dirPath, 'a.txt'), 'a');
    gitIn(dirPath, 'add', '.');
    gitIn(dirPath, 'commit', '-q', '-m', 'init');
    const report = await buildMachineReport(ctx, company, machine);
    expect(report.checkouts).toEqual([
      { path: dirPath, head: expect.stringMatching(/^[0-9a-f]{40}$/), clean: true },
    ]);
  });
});
