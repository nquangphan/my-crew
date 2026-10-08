import { hostname } from 'node:os';
import { doctor, parseLoad, parsePendingTccPrompts, TCC_PREDICATE } from '../commands/doctor.js';
import type { MacContext } from '../context.js';
import { readInstalledPlugins } from '../workflows/install.js';
import { SUPERPOWERS_PLUGIN_KEY } from '../workflows/pin.js';

export interface MachineReport {
  version: 1;
  machineId: string;
  hostname: string;
  sentAt: string;
  load1: number | null;
  cpuCount: number | null;
  memFreePct: number | null;
  tccPending: { service: string; client: string; since: string }[];
  claude: { version: string | null; loggedIn: boolean; plan: string | null };
  superpowers: { pinned: string; ownerInstalled: string | null };
  checks: { id: string; status: 'ok' | 'warn' | 'error'; title: string }[];
}

function finite(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

export async function buildMachineReport(
  ctx: MacContext,
  machineId: string,
  _env: NodeJS.ProcessEnv = {},
): Promise<MachineReport> {
  const [checks, loadavg, cpu, memory, tcc, version, auth] = await Promise.all([
    doctor(ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 }),
    ctx.runner.run('/usr/sbin/sysctl', ['-n', 'vm.loadavg'], { timeoutMs: 10_000 }),
    ctx.runner.run('/usr/sbin/sysctl', ['-n', 'hw.ncpu'], { timeoutMs: 10_000 }),
    ctx.runner.run('/usr/bin/memory_pressure', ['-Q'], { timeoutMs: 10_000 }),
    ctx.runner.run(
      '/usr/bin/log',
      ['show', '--last', '24h', '--style', 'compact', '--predicate', TCC_PREDICATE],
      { timeoutMs: 10_000 },
    ),
    ctx.runner.run('claude', ['--version'], { timeoutMs: 10_000 }),
    ctx.runner.run('claude', ['auth', 'status'], { timeoutMs: 10_000 }),
  ]);
  const load = parseLoad(loadavg.stdout, cpu.stdout, memory.stdout);
  const pending = tcc.code === 0 ? parsePendingTccPrompts(tcc.stdout).pending.slice(0, 20) : [];
  let authState: { loggedIn?: boolean; subscriptionType?: string } = {};
  try {
    authState = JSON.parse(auth.stdout);
  } catch {
    /* Không tiết lộ output lỗi. */
  }
  const ownerInstalled = readInstalledPlugins(ctx.home, SUPERPOWERS_PLUGIN_KEY)[0]?.version ?? null;
  const report: MachineReport = {
    version: 1,
    machineId,
    hostname: hostname().slice(0, 255),
    sentAt: ctx.now().toISOString(),
    load1: finite(load.load1),
    cpuCount: finite(load.ncpu),
    memFreePct: finite(load.freePct),
    tccPending: pending.map((p) => ({
      service: p.service,
      client: p.subject.slice(0, 256),
      since: new Date(p.at.replace(' ', 'T')).toISOString(),
    })),
    claude: {
      version: version.code === 0 ? (/^\d+\.\d+\.\d+/.exec(version.stdout.trim())?.[0] ?? null) : null,
      loggedIn: authState.loggedIn === true,
      plan: authState.loggedIn === true ? (authState.subscriptionType?.slice(0, 50) ?? null) : null,
    },
    superpowers: { pinned: ctx.superpowersPin.version, ownerInstalled },
    checks: checks.map((c) => ({
      id: c.id,
      status: c.status === 'fail' ? 'error' : c.status,
      title: c.title,
    })),
  };
  if (Buffer.byteLength(JSON.stringify(report)) > 16 * 1024) throw new Error('Bản tin máy vượt quá 16 KB');
  return report;
}
