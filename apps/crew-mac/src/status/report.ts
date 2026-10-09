import { existsSync, readdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { doctor, parseLoad } from '../commands/doctor.js';
import { readStatusConfig, resolveClaudePath } from '../commands/status.js';
import type { MacContext } from '../context.js';
import { type AttachmentCacheStats, attachmentCacheStats } from '../files/stats.js';
import { macPaths } from '../paths.js';
import { readInstalledPlugins } from '../workflows/install.js';
import { SUPERPOWERS_PLUGIN_KEY, superpowersPinDir } from '../workflows/pin.js';
import { type AppReport, type JobsAgentReport, readAppState, readJobsAgent } from './app-state.js';
import { type CheckoutInfo, scanCheckouts } from './checkouts.js';
import { probeStatusTcc } from './tcc.js';

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
  superpowers: {
    pinned: string | null;
    ownerInstalled: string | null;
    /** Thư mục bản ghim (giá trị `--plugin-dir` của agent); null khi chưa có bản ghim. */
    pinDir?: string | null;
    /** Tên thư mục skill (có `SKILL.md`) trong bản ghim, sắp xếp, tối đa 100. */
    skills?: string[];
  };
  checks: { id: string; status: 'ok' | 'warn' | 'error'; title: string }[];
  app?: AppReport;
  attachmentCache?: AttachmentCacheStats;
  /** Thư mục git `~/crew-agents/<project>/<role>`, tối đa 64, sắp theo path. */
  checkouts?: CheckoutInfo[];
  /** App 2P Crew đang nhận việc trên máy (đọc từ `app.json`); thiếu nghĩa là app không nhận việc. */
  jobsAgent?: JobsAgentReport;
}

/** Giới hạn body webhook `machine-status` của plugin (bản có `checkouts`, `jobsAgent`). */
export const MACHINE_REPORT_MAX_BYTES = 64 * 1024;
const MAX_SKILLS = 100;

function pinnedSkills(pinDir: string): string[] {
  try {
    return readdirSync(join(pinDir, 'skills'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(pinDir, 'skills', entry.name, 'SKILL.md')))
      .map((entry) => entry.name)
      .filter((name) => name.length <= 200)
      .sort()
      .slice(0, MAX_SKILLS);
  } catch {
    return [];
  }
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
  const [checks, loadavg, cpu, memory, tcc, version, auth, checkouts] = await Promise.all([
    doctor(ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90, skipTcc: true }).catch(() => []),
    ctx.runner.run('/usr/sbin/sysctl', ['-n', 'vm.loadavg'], { timeoutMs: 10_000 }),
    ctx.runner.run('/usr/sbin/sysctl', ['-n', 'hw.ncpu'], { timeoutMs: 10_000 }),
    ctx.runner.run('/usr/bin/memory_pressure', ['-Q'], { timeoutMs: 10_000 }),
    probeStatusTcc(ctx),
    claudePath
      ? ctx.runner.run(claudePath, ['--version'], { timeoutMs: 10_000 })
      : Promise.resolve({ code: 127, stdout: '' }),
    claudePath
      ? ctx.runner.run(claudePath, ['auth', 'status'], { timeoutMs: 10_000 })
      : Promise.resolve({ code: 127, stdout: '' }),
    scanCheckouts(ctx.home),
  ]);
  const load = parseLoad(loadavg.stdout, cpu.stdout, memory.stdout);
  const pending = tcc.pending.slice(0, 20);
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
  const app = readAppState(macPaths(ctx.home).appState);
  const jobsAgent = readJobsAgent(macPaths(ctx.home).appState);
  const pinDir = superpowersPinDir(ctx.home, ctx.superpowersPin);
  const pinned = existsSync(pinDir);
  const report: MachineReport = {
    version: 1,
    companyId,
    machineId,
    hostname: hostname().slice(0, 200),
    sentAt: ctx.now().toISOString(),
    load1: loadavg.code === 0 && !loadavg.timedOut ? bounded(load.load1, 0, 1000) : null,
    cpuCount: cpu.code === 0 && !cpu.timedOut ? bounded(load.ncpu, 1, 1024) : null,
    memFreePct: memory.code === 0 && !memory.timedOut ? bounded(load.freePct, 0, 100) : null,
    tccPending: pending.map((prompt) => ({
      service: prompt.service,
      client: prompt.client.slice(0, 200),
      since: prompt.since,
    })),
    claude: {
      version: version.code === 0 ? (/^\d+\.\d+\.\d+/.exec(version.stdout.trim())?.[0] ?? null) : null,
      loggedIn: auth.code === 0 && typeof authState.loggedIn === 'boolean' ? authState.loggedIn : null,
      plan: authState.loggedIn === true ? (authState.subscriptionType?.slice(0, 50) ?? null) : null,
    },
    superpowers: {
      pinned: pinned ? ctx.superpowersPin.version : null,
      ownerInstalled,
      pinDir: pinned ? pinDir : null,
      ...(pinned ? { skills: pinnedSkills(pinDir) } : {}),
    },
    checks: [
      ...checks.map((c) => ({
        id: c.id,
        status: c.status === 'fail' ? ('error' as const) : c.status,
        title: c.title,
      })),
      ...(tcc.check ? [tcc.check] : []),
    ],
    ...(app ? { app } : {}),
    checkouts,
    ...(jobsAgent ? { jobsAgent } : {}),
  };
  const cache = attachmentCacheStats(ctx.home, ctx.now());
  if (cache) report.attachmentCache = cache;
  if (Buffer.byteLength(JSON.stringify(report)) > MACHINE_REPORT_MAX_BYTES)
    throw new Error('Bản tin máy vượt quá 64 KB');
  return report;
}
