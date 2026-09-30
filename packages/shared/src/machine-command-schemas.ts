import { z } from 'zod';
import { JobView, LogLine } from './desktop-ipc.js';
import { HealthFixId, HealthGroup, HealthReport } from './health-schemas.js';
import { ProjectKey } from './project-schemas.js';

/**
 * Remote actions the owner triggers on a machine from the web: pause and resume, the health checks and their
 * one-click fixes, an inventory re-probe, the BMAD install, the job list and a log tail. Only these fixed
 * actions exist (validated by the server and again by the daemon): the web can never run an arbitrary command
 * on a machine. The daemon runs each one and reports its result, which the web shows.
 */
export const MachineCommandRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pause') }).strict(),
  z.object({ action: z.literal('resume') }).strict(),
  /** `quick` skips the paid login probe and the slow probes (like the 5-minute schedule). */
  z.object({ action: z.literal('health.run'), quick: z.boolean().default(false) }).strict(),
  /** A fix the last report offered (same fix ids as the desktop dashboard and `crewd doctor`). */
  z.object({ action: z.literal('health.fix'), group: HealthGroup, fixId: HealthFixId }).strict(),
  /** Re-probes the skills and MCP servers agents see; `projectKey` null for the machine-level inventory. */
  z.object({ action: z.literal('inventory.refresh'), projectKey: ProjectKey.nullable() }).strict(),
  /** Installs the project's BMAD profile into its folder on the machine (never over an existing install). */
  z.object({ action: z.literal('bmad.install'), projectKey: ProjectKey }).strict(),
  z.object({ action: z.literal('jobs.list') }).strict(),
  /** The machine gives the project up (its running jobs stop, queued ones are dropped); the owner reassigns it. */
  z.object({ action: z.literal('project.release'), projectKey: ProjectKey }).strict(),
  /** The machine gives the assistant role up. */
  z.object({ action: z.literal('assistant.release') }).strict(),
  z
    .object({
      action: z.literal('logs.tail'),
      limit: z.number().int().min(1).max(500).default(200),
      /** Only the lines of one ticket (key or id) or job id. */
      ticket: z.string().trim().max(100).optional(),
    })
    .strict(),
]);
export type MachineCommandRequest = z.input<typeof MachineCommandRequest>;
export type MachineCommandParsed = z.output<typeof MachineCommandRequest>;

export const MachineCommandAction = z.enum([
  'pause',
  'resume',
  'health.run',
  'health.fix',
  'inventory.refresh',
  'bmad.install',
  'jobs.list',
  'logs.tail',
  'project.release',
  'assistant.release',
]);
export type MachineCommandAction = z.infer<typeof MachineCommandAction>;

export const MACHINE_COMMAND_LABEL: Record<MachineCommandAction, string> = {
  pause: 'Tạm dừng máy',
  resume: 'Cho máy chạy tiếp',
  'health.run': 'Kiểm tra sức khỏe',
  'health.fix': 'Sửa lỗi sức khỏe',
  'inventory.refresh': 'Dò lại skill và MCP',
  'bmad.install': 'Cài BMAD',
  'jobs.list': 'Danh sách job',
  'logs.tail': 'Log gần nhất',
  'project.release': 'Gỡ dự án khỏi máy',
  'assistant.release': 'Bỏ vai trò trợ lý',
};

/** A pending command older than this is never started (a machine that was off must not act on it later). */
export const MACHINE_COMMAND_TTL_MS = 10 * 60 * 1000;

/** How long the daemon lets one action run before it reports a failure. */
export const MACHINE_COMMAND_TIMEOUT_MS: Record<MachineCommandAction, number> = {
  pause: 30_000,
  resume: 30_000,
  'health.run': 5 * 60_000,
  'health.fix': 5 * 60_000,
  'inventory.refresh': 5 * 60_000,
  'bmad.install': 20 * 60_000,
  'jobs.list': 60_000,
  'logs.tail': 60_000,
  'project.release': 60_000,
  'assistant.release': 60_000,
};

export const PausedResult = z.object({ paused: z.boolean() });
export const InventoryCountResult = z.object({
  skills: z.number().int().min(0),
  mcpServers: z.number().int().min(0),
});
export const ReleaseResult = z.object({ status: z.enum(['released', 'withdrawn']) });
export const BmadCommandResult = z.object({
  status: z.enum(['skipped', 'installed']),
  message: z.string().max(5_000),
});

/** The result each action reports; the server refuses a result of another shape. */
export const MACHINE_COMMAND_RESULT: Record<MachineCommandAction, z.ZodType> = {
  pause: PausedResult,
  resume: PausedResult,
  'health.run': HealthReport,
  'health.fix': HealthReport,
  'inventory.refresh': InventoryCountResult,
  'bmad.install': BmadCommandResult,
  'jobs.list': z.array(JobView).max(500),
  'logs.tail': z.array(LogLine).max(500),
  'project.release': ReleaseResult,
  'assistant.release': ReleaseResult,
};

/**
 * `pending`: waiting for the machine. `running`: the daemon started it. `done` / `failed`: its result or
 * error is in. `expired`: the machine did not take it within MACHINE_COMMAND_TTL_MS.
 */
export const MachineCommandStatus = z.enum(['pending', 'running', 'done', 'failed', 'expired']);
export type MachineCommandStatus = z.infer<typeof MachineCommandStatus>;

export const MachineCommand = z.object({
  id: z.string(),
  machineId: z.string(),
  action: MachineCommandAction,
  /** The action's parameters (the request without `action`). */
  params: z.record(z.string(), z.unknown()),
  status: MachineCommandStatus,
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  /** `owner:<username>`. */
  requestedBy: z.string(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});
export type MachineCommand = z.infer<typeof MachineCommand>;

export const MachineCommandListResponse = z.object({ items: z.array(MachineCommand) });
export type MachineCommandListResponse = z.infer<typeof MachineCommandListResponse>;

/** `POST /v1/daemon/commands/:id/result`: the outcome of a command the daemon started. */
export const MachineCommandResultRequest = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: z.unknown() }).strict(),
  z.object({ ok: z.literal(false), error: z.string().trim().min(1).max(2_000) }).strict(),
]);
export type MachineCommandResultRequest = z.input<typeof MachineCommandResultRequest>;
