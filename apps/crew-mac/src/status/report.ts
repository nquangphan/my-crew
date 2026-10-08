import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { doctor, parseLoad, parsePendingTccPrompts, TCC_PREDICATE } from '../commands/doctor.js';
import { readStatusConfig, resolveClaudePath } from '../commands/status.js';
import type { MacContext } from '../context.js';
import { readInstalledPlugins } from '../workflows/install.js';
import { SUPERPOWERS_PLUGIN_KEY, superpowersPinDir } from '../workflows/pin.js';

export interface MachineReport {
  version: 1;
  companyId: string;
  machineId: string;
  hostname: string;
  sentAt: string;
  load1: number | null;
  cpuCount: number | null;
  memFreePct: number | null;
  tccPending: { service: string; client: string; since: string }[];
  claude: { version: string | null; loggedIn: boolean | null; plan: string | null };
  superpowers: { pinned: string | null; ownerInstalled: string | null };
  checks: { id: string; status: 'ok' | 'warn' | 'error'; title: string }[];
}

function bounded(value: number, min: number, max: number): number | null {
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}

export async function buildMachineReport(
  ctx: MacContext,
  companyId: string,
  machineId: string,
  _env: NodeJS.ProcessEnv = {},
): Promise<MachineReport> {
  const claudePath = readStatusConfig(ctx)?.claudePath ?? resolveClaudePath(ctx.home);
  const [checks, loadavg, cpu, memory, tcc, version, auth] = await Promise.all([
    doctor(ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 }).catch(() => []),
    ctx.runner.run('/usr/sbin/sysctl', ['-n', 'vm.loadavg'], { timeoutMs: 10_000 }),
    ctx.runner.run('/usr/sbin/sysctl', ['-n', 'hw.ncpu'], { timeoutMs: 10_000 }),
    ctx.runner.run('/usr/bin/memory_pressure', ['-Q'], { timeoutMs: 10_000 }),
    ctx.runner.run(
      '/usr/bin/log',
      ['show', '--last', '24h', '--style', 'compact', '--predicate', TCC_PREDICATE],
      { timeoutMs: 10_000 },
    ),
    claudePath
      ? ctx.runner.run(claudePath, ['--version'], { timeoutMs: 10_000 })
      : Promise.resolve({ code: 127, stdout: '' }),
    claudePath
      ? ctx.runner.run(claudePath, ['auth', 'status'], { timeoutMs: 10_000 })
      : Promise.resolve({ code: 127, stdout: '' }),
  ]);
  const load = parseLoad(loadavg.stdout, cpu.stdout, memory.stdout);
  const pending = tcc.code === 0 ? parsePendingTccPrompts(tcc.stdout).pending.slice(0, 20) : [];
  let authState: { loggedIn?: boolean; subscriptionType?: string } = {};
  try {
    authState = JSON.parse(auth.stdout);
  } catch {
    /* Không tiết lộ output lỗi. */
  }
  let ownerInstalled: string | null = null;
  try {
    ownerInstalled = readInstalledPlugins(ctx.home, SUPERPOWERS_PLUGIN_KEY)[0]?.version ?? null;
  } catch {
    /* không đọc được probe */
  }
  const report: MachineReport = {
    version: 1,
    companyId,
    machineId,
    hostname: hostname().slice(0, 200),
    sentAt: ctx.now().toISOString(),
    load1: loadavg.code === 0 && !loadavg.timedOut ? bounded(load.load1, 0, 1000) : null,
    cpuCount: cpu.code === 0 && !cpu.timedOut ? bounded(load.ncpu, 1, 1024) : null,
    memFreePct: memory.code === 0 && !memory.timedOut ? bounded(load.freePct, 0, 100) : null,
    tccPending: pending.map((p) => ({
      service: p.service,
      client: p.subject.slice(0, 200),
      since: new Date(p.at.replace(' ', 'T')).toISOString(),
    })),
    claude: {
      version: version.code === 0 ? (/^\d+\.\d+\.\d+/.exec(version.stdout.trim())?.[0] ?? null) : null,
      loggedIn: auth.code === 0 && typeof authState.loggedIn === 'boolean' ? authState.loggedIn : null,
      plan: authState.loggedIn === true ? (authState.subscriptionType?.slice(0, 50) ?? null) : null,
    },
    superpowers: {
      pinned: existsSync(superpowersPinDir(ctx.home, ctx.superpowersPin)) ? ctx.superpowersPin.version : null,
      ownerInstalled,
    },
    checks: checks.map((c) => ({
      id: c.id,
      status: c.status === 'fail' ? 'error' : c.status,
      title: c.title,
    })),
  };
  if (Buffer.byteLength(JSON.stringify(report)) > 16 * 1024) throw new Error('Bản tin máy vượt quá 16 KB');
  return report;
}
