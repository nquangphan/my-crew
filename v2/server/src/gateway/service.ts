import { createHash, randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { samePin } from '../../../src/workflow-policy.ts';
import { authenticateCurrentCredential } from '../auth/routes.ts';
import { readSessionCookie, sha256 } from '../auth/session.ts';
import { authorizeAttemptMutation } from '../execution/attempts.ts';
import { canonicalJson } from '../journal/canonical.ts';
import { appendEvent, parseCursor } from '../journal/events.ts';
import type { Actor, Id, ServerOptions, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type {
  AttemptProjectionPin,
  ConfigInput,
  GatewayAck,
  GatewayApplied,
  GatewayCommand,
  GatewayConfig,
  GatewayHeartbeat,
  GatewayProjectionPolicy,
  GatewayStatus,
  InstallReport,
  InstallReportResponse,
  ProjectionInput,
  ProjectionPin,
  ProjectionSlotStatus,
  Runtime,
  SourcePin,
  Workflow,
  WorkflowInventory,
  WorkflowRetryResult,
} from './contracts.ts';
import { runtimes, toDomainPin, workflows } from './contracts.ts';

const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const hash = (body: unknown) => createHash('sha256').update(canonicalJson(body)).digest('hex');
const json = (body: unknown) => JSON.parse(canonicalJson(body));
function fail(code: string, status = 409): never {
  throw new ApiError(code, status, 'Yêu cầu cổng máy không còn hợp lệ');
}
export const denyProjectionSelection: GatewayProjectionPolicy = {
  authorize: async () => fail('SELECTION_NOT_CONFIGURED', 503),
};

/** Lock order: journal cursor → existing 005 root/ticket/project → machine → 007 rows. */
export async function authorizeGatewayMutation(
  tx: Tx,
  request: FastifyRequest,
  actor: Actor,
  options: ServerOptions,
  machineId: Id,
  attemptId?: Id,
): Promise<void> {
  if (attemptId) {
    await authorizeAttemptMutation(tx, attemptId, actor);
    await lockCurrentAttempt(tx, attemptId, actor, request.body as ProjectionInput);
  }
  const [machine] = await tx`select id,revoked_at from machines where id=${machineId} for update`;
  if (!machine || machine.revoked_at || (actor.kind === 'machine' && actor.id !== machineId))
    fail('NOT_FOUND', 404);
  if (actor.kind === 'owner') {
    const secret = readSessionCookie(request);
    if (!secret) fail('UNAUTHENTICATED', 401);
    await tx`select id_hash from sessions where id_hash=${sha256(secret)} for share`;
  }
  const current = await authenticateCurrentCredential(tx, request, options.now());
  if (current.kind !== actor.kind || current.id !== actor.id) fail('UNAUTHENTICATED', 401);
}

const officialReleases = {
  bmad: {
    version: '6.12.0',
    revision: '05bfbd46d00766ec88eb9b42e76be2c575d64d7b',
    repo: 'bmad-code-org/BMAD-METHOD',
  },
  superpowers: {
    version: '6.4.2',
    revision: '8ca22dba9a94f28898bbce59f2537ff4d87c747d',
    repo: 'obra/superpowers',
  },
} as const;
/** HTTPS source locations accepted for an official release; single source for validation and catalogue. */
export function officialSourceUrls(name: Workflow): string[] {
  const release = officialReleases[name];
  const suffixes = [release.revision, `refs/tags/v${release.version}`];
  const urls = suffixes.flatMap((suffix) => [
    `https://github.com/${release.repo}/archive/${suffix}.tar.gz`,
    `https://codeload.github.com/${release.repo}/tar.gz/${suffix}`,
  ]);
  if (name === 'bmad')
    urls.push(`https://registry.npmjs.org/bmad-method/-/bmad-method-${release.version}.tgz`);
  return urls;
}
export const officialRelease = (name: Workflow) => ({
  version: officialReleases[name].version,
  sourceRevision: officialReleases[name].revision,
  allowedSourceUrls: officialSourceUrls(name),
});
export function validateOfficialSource(pin: SourcePin): void {
  const release = officialReleases[pin.name];
  if (!release) fail('WORKFLOW_SOURCE_INVALID', 400);
  if (pin.version !== release.version || pin.sourceRevision !== release.revision)
    fail('WORKFLOW_SOURCE_INVALID', 400);
  let url: URL;
  try {
    url = new URL(pin.sourceUrl);
  } catch {
    fail('WORKFLOW_SOURCE_INVALID', 400);
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.href !== pin.sourceUrl
  )
    fail('WORKFLOW_SOURCE_INVALID', 400);
  const allowed = officialSourceUrls(pin.name);
  if (
    !allowed.includes(pin.sourceUrl) ||
    (url.hostname === 'registry.npmjs.org') !== (pin.packageIntegrity !== null)
  )
    fail('WORKFLOW_SOURCE_INVALID', 400);
}
function validateDesired(input: ConfigInput): void {
  for (const workflow of workflows) {
    const desired = input.desired[workflow];
    if (desired.source.name !== workflow) fail('WORKFLOW_SOURCE_INVALID', 400);
    validateOfficialSource(desired.source);
    for (const runtime of runtimes) {
      const projection = desired.projections[runtime];
      if (
        projection &&
        (projection.runtime !== runtime || projection.sourceTreeSha256 !== desired.source.sourceTreeSha256)
      )
        fail('WORKFLOW_PIN_MISMATCH');
    }
  }
}
function cleanInventory(input: WorkflowInventory): WorkflowInventory {
  const result: WorkflowInventory = structuredClone(input);
  for (const workflow of workflows) {
    const status = result[workflow];
    if (status.source.installed) validateOfficialSource(status.source.installed);
    for (const slot of [status.source, ...runtimes.map((runtime) => status.projections[runtime])]) {
      if (slot.lastError) slot.lastError = { code: 'INSTALLATION_ERROR', message: 'Cài workflow gặp lỗi' };
    }
  }
  return result;
}
function missingInventory(): WorkflowInventory {
  const slot = () => ({ state: 'missing' as const, installed: null, lastError: null, observedAt: null });
  const workflow = () => ({ source: slot(), projections: { claude: slot(), codex: slot(), api: slot() } });
  return { bmad: workflow(), superpowers: workflow() };
}
function mapConfig(row: Record<string, unknown>): GatewayConfig {
  return {
    revision: Number(row.revision),
    desired: row.desired as GatewayConfig['desired'],
    maxJobs: Number(row.max_jobs),
    enabled: row.enabled as boolean,
  };
}
export async function readGatewayConfig(tx: Tx, machineId: Id): Promise<GatewayConfig | null> {
  const [row] = await tx`select * from gateway_configs where machine_id=${machineId}`;
  return row ? mapConfig(row) : null;
}
export async function readGatewayApplied(tx: Tx, machineId: Id): Promise<GatewayApplied | null> {
  const [row] = await tx`select * from gateway_applied where machine_id=${machineId}`;
  return row
    ? {
        revision: Number(row.revision),
        workflows: row.workflow_status as WorkflowInventory,
        appliedAt: row.applied_at ? (row.applied_at as Date).toISOString() : null,
      }
    : null;
}
/**
 * Desired state of one runtime source (claude, codex, api) for fresh admission. Pure read of authority
 * already stored: the machine-wide gateway `enabled` flag is a master switch, then the per-source switch
 * in `model_source_configs`. A machine with no source config yet (older config) derives every source from
 * the master flag, so existing machines keep their previous behaviour. An OFF source never cancels an
 * attempt that was already admitted; callers use this only for new admission.
 */
export async function isSourceEnabled(tx: Tx, machineId: Id, runtime: Runtime): Promise<boolean> {
  // Defensive: the route already validates the enum, but other callers may not.
  if (!runtimes.includes(runtime)) return false;
  const [row] =
    await tx`select g.enabled as master, (m.enabled->>${runtime}) as source from gateway_configs g left join model_source_configs m on m.machine_id=g.machine_id where g.machine_id=${machineId}`;
  if (row?.master !== true) return false;
  return row.source == null ? true : row.source === 'true';
}
async function event(tx: Tx, machineId: Id, type: string, data: Record<string, unknown>): Promise<void> {
  await appendEvent(tx, { type, projectId: null, ticketId: null, audienceMachineId: machineId, data });
}
export async function writeGatewayConfig(
  tx: Tx,
  machineId: Id,
  input: ConfigInput,
  now: Date,
): Promise<GatewayConfig> {
  validateDesired(input);
  const existing = await readGatewayConfig(tx, machineId);
  if ((existing?.revision ?? 0) !== input.expectedRevision) fail('CONFIG_REVISION_CONFLICT');
  const body = { desired: input.desired, maxJobs: input.maxJobs, enabled: input.enabled };
  if (
    existing &&
    same({ desired: existing.desired, maxJobs: existing.maxJobs, enabled: existing.enabled }, body)
  )
    return existing;
  const revision = (existing?.revision ?? 0) + 1;
  if (revision > 2147483647) fail('CONFIG_REVISION_EXHAUSTED');
  await tx`insert into gateway_configs(machine_id,revision,desired,max_jobs,enabled,updated_at) values(${machineId},${revision},${tx.json(json(input.desired))},${input.maxJobs},${input.enabled},${now}) on conflict(machine_id) do update set revision=excluded.revision,desired=excluded.desired,max_jobs=excluded.max_jobs,enabled=excluded.enabled,updated_at=excluded.updated_at`;
  const [cursor] = await tx`update gateway_command_cursor set value=value+1 where singleton returning value`;
  const commandId = randomUUID();
  await tx`insert into gateway_commands(id,machine_id,type,payload,state,created_at,cursor) values(${commandId},${machineId},'sync_workflows',${tx.json({ configRevision: revision })},'queued',${now},${cursor?.value})`;
  await event(tx, machineId, 'gateway.config.changed', { revision });
  await event(tx, machineId, 'gateway.command.created', { commandId, type: 'sync_workflows' });
  return { revision, ...body };
}
export async function registerBoot(
  tx: Tx,
  machineId: Id,
  input: { bootId: Id; previousGeneration: string },
  now: Date,
) {
  parseCursor(input.previousGeneration);
  const [prior] =
    await tx`select * from gateway_boots where machine_id=${machineId} and boot_id=${input.bootId}`;
  if (prior) {
    if (prior.retired_at) fail('BOOT_RETIRED');
    if (String(prior.previous_generation) !== input.previousGeneration) fail('BOOT_GENERATION_CONFLICT');
    return {
      bootGeneration: String(prior.boot_generation),
      serverTime: (prior.created_at as Date).toISOString(),
    };
  }
  const [latest] = await tx`select * from gateway_boots where machine_id=${machineId} and retired_at is null`;
  if (String(latest?.boot_generation ?? 0) !== input.previousGeneration) fail('BOOT_GENERATION_CONFLICT');
  if (input.previousGeneration === '9223372036854775807') fail('BOOT_GENERATION_EXHAUSTED');
  const bootGeneration = (BigInt(input.previousGeneration) + 1n).toString();
  if (latest)
    await tx`update gateway_boots set retired_at=${now} where machine_id=${machineId} and boot_id=${latest.boot_id}`;
  await tx`insert into gateway_boots(machine_id,boot_id,boot_generation,previous_generation,created_at) values(${machineId},${input.bootId},${bootGeneration},${input.previousGeneration},${now})`;
  await event(tx, machineId, 'gateway.booted', { bootId: input.bootId, bootGeneration });
  return { bootGeneration, serverTime: now.toISOString() };
}
async function assertBoot(tx: Tx, machineId: Id, bootId: Id, generation: string): Promise<void> {
  parseCursor(generation);
  const [boot] =
    await tx`select 1 from gateway_boots where machine_id=${machineId} and boot_id=${bootId} and boot_generation=${generation} and retired_at is null`;
  if (!boot) fail('BOOT_RETIRED');
}
export async function saveHeartbeat(tx: Tx, machineId: Id, input: GatewayHeartbeat, now: Date) {
  parseCursor(input.bootGeneration);
  parseCursor(input.sequence);
  const bodyHash = hash(input);
  const [receipt] =
    await tx`select body_hash,response from gateway_heartbeat_receipts where machine_id=${machineId} and boot_generation=${input.bootGeneration} and sequence=${input.sequence}`;
  if (receipt) {
    if (receipt.body_hash !== bodyHash) fail('HEARTBEAT_SEQUENCE_CONFLICT');
    return receipt.response;
  }
  await assertBoot(tx, machineId, input.bootId, input.bootGeneration);
  const [current] =
    await tx`select sequence,boot_generation from gateway_heartbeats where machine_id=${machineId}`;
  if (
    current &&
    String(current.boot_generation) === input.bootGeneration &&
    BigInt(input.sequence) <= BigInt(String(current.sequence))
  )
    fail('HEARTBEAT_SEQUENCE_CONFLICT');
  const inventory = cleanInventory(input.inventory);
  await tx`insert into gateway_heartbeats(machine_id,boot_id,boot_generation,sequence,received_at,telemetry,host_version,app_version,inventory,processes,observed_at) values(${machineId},${input.bootId},${input.bootGeneration},${input.sequence},${now},${tx.json(json(input.telemetry))},${input.hostVersion},${input.appVersion},${tx.json(json(inventory))},${tx.json(json(input.processes))},${input.observedAt}) on conflict(machine_id) do update set boot_id=excluded.boot_id,boot_generation=excluded.boot_generation,sequence=excluded.sequence,received_at=excluded.received_at,telemetry=excluded.telemetry,host_version=excluded.host_version,app_version=excluded.app_version,inventory=excluded.inventory,processes=excluded.processes,observed_at=excluded.observed_at`;
  const [cursor] =
    await tx`select coalesce(max(cursor),0) as value from gateway_commands where machine_id=${machineId}`;
  const response = {
    serverTime: now.toISOString(),
    desiredConfig: await readGatewayConfig(tx, machineId),
    commandsCursor: String(cursor?.value ?? 0),
  };
  await tx`insert into gateway_heartbeat_receipts(machine_id,boot_generation,sequence,body_hash,response,received_at) values(${machineId},${input.bootGeneration},${input.sequence},${bodyHash},${tx.json(json(response))},${now})`;
  return response;
}
/**
 * A projection definition is trusted only when the slot holds exactly the desired source and projection
 * pins and the digest equals the gateway's canonical identity over those pins, skills and customization.
 */
export function definitionMatches(
  slot: ProjectionSlotStatus,
  source: SourcePin,
  projection: ProjectionPin | null,
  installedSource: SourcePin | null,
): boolean {
  const definition = slot.definition;
  if (!definition || !projection || slot.state !== 'current') return false;
  if (!same(slot.installed, projection) || !same(installedSource, source)) return false;
  if (
    definition.render &&
    (!same(definition.render.source, source) || !same(definition.render.projection, projection))
  )
    return false;
  return (
    definition.sha256 ===
    hash({
      source,
      projection,
      skills: definition.skills,
      customizationSha256: definition.customizationSha256,
      render: definition.render ?? null,
    })
  );
}
export async function saveInstallReport(
  tx: Tx,
  machineId: Id,
  input: InstallReport,
  now: Date,
): Promise<InstallReportResponse> {
  const bodyHash = hash(input);
  const [prior] =
    await tx`select machine_id,body_hash,response from gateway_install_reports where id=${input.reportId}`;
  if (prior) {
    if (prior.machine_id !== machineId) fail('NOT_FOUND', 404);
    if (prior.body_hash !== bodyHash) fail('INSTALL_REPORT_CONFLICT');
    return prior.response as InstallReportResponse;
  }
  await assertBoot(tx, machineId, input.bootId, input.bootGeneration);
  const config = await readGatewayConfig(tx, machineId);
  if (!config) fail('CONFIG_NOT_CONFIGURED');
  if (config.revision !== input.configRevision) fail('CONFIG_REVISION_CONFLICT');
  const status = cleanInventory(input.results);
  let accepted = true;
  for (const workflow of workflows) {
    const wanted = config.desired[workflow];
    const reported = status[workflow];
    if (reported.source.state !== 'current' || !same(reported.source.installed, wanted.source)) {
      accepted = false;
      if (reported.source.state === 'current') reported.source.state = 'mismatch';
    }
    for (const runtime of runtimes) {
      const pin = wanted.projections[runtime],
        slot = reported.projections[runtime];
      if (pin && (slot.state !== 'current' || !same(slot.installed, pin))) {
        accepted = false;
        if (slot.state === 'current') slot.state = 'mismatch';
      }
      if (!pin && slot.state === 'current') slot.state = 'mismatch';
      if (slot.definition && !definitionMatches(slot, wanted.source, pin, reported.source.installed)) {
        // An unprovable definition is never stored, so a lookup can only see one tied to the exact pin.
        delete slot.definition;
        accepted = false;
        if (slot.state === 'current') slot.state = 'mismatch';
        slot.lastError ??= {
          code: 'DEFINITION_MISMATCH',
          message: 'Definition workflow không khớp pin đã cài',
        };
      }
    }
  }
  const previous = await readGatewayApplied(tx, machineId);
  const appliedRevision = accepted ? config.revision : (previous?.revision ?? 0);
  const appliedAt = accepted ? now : previous?.appliedAt ? new Date(previous.appliedAt) : null;
  await tx`insert into gateway_applied(machine_id,revision,inventory,workflow_status,applied_at,latest_report_id) values(${machineId},${appliedRevision},${tx.json(json(status))},${tx.json(json(status))},${appliedAt},${input.reportId}) on conflict(machine_id) do update set revision=excluded.revision,inventory=excluded.inventory,workflow_status=excluded.workflow_status,applied_at=excluded.applied_at,latest_report_id=excluded.latest_report_id`;
  const response: InstallReportResponse = { accepted, appliedRevision, workflows: status };
  await tx`insert into gateway_install_reports(id,machine_id,boot_generation,config_revision,body_hash,report,response,received_at) values(${input.reportId},${machineId},${input.bootGeneration},${input.configRevision},${bodyHash},${tx.json(json({ ...input, results: status }))},${tx.json(json(response))},${now})`;
  await event(tx, machineId, 'gateway.install.reported', {
    reportId: input.reportId,
    revision: input.configRevision,
    accepted,
  });
  return response;
}
export function mapCommand(row: Record<string, unknown>): GatewayCommand {
  return {
    id: row.id as Id,
    machineId: row.machine_id as Id,
    type: row.type as GatewayCommand['type'],
    payload: row.payload as GatewayCommand['payload'],
    state: row.state as GatewayCommand['state'],
    result: row.result as GatewayCommand['result'],
    cursor: String(row.cursor),
    createdAt: (row.created_at as Date).toISOString(),
    receivedAt: row.received_at ? (row.received_at as Date).toISOString() : null,
    completedAt: row.completed_at ? (row.completed_at as Date).toISOString() : null,
  };
}
export async function listGatewayCommands(tx: Tx, machineId: Id, after: string, limit: number) {
  parseCursor(after);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('LIMIT_INVALID', 400);
  const rows =
    await tx`select * from gateway_commands where machine_id=${machineId} and cursor>${after} order by cursor limit ${limit}`;
  const items = rows.map(mapCommand);
  return { items, nextCursor: items.at(-1)?.cursor ?? after };
}
function validateAckDetails(value: unknown, depth = 0): void {
  if (depth > 4) fail('INVALID_INPUT', 400);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return;
  if (typeof value === 'string') {
    if (
      value.length > 200 ||
      [...value].some((character) => character.charCodeAt(0) < 32) ||
      /[\\/]|token|password|credential|secret|bearer/i.test(value)
    )
      fail('INVALID_INPUT', 400);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 20) fail('INVALID_INPUT', 400);
    for (const item of value) validateAckDetails(item, depth + 1);
    return;
  }
  if (!value || typeof value !== 'object' || Object.keys(value).length > 20) fail('INVALID_INPUT', 400);
  for (const [key, item] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || /token|password|credential|secret/i.test(key))
      fail('INVALID_INPUT', 400);
    validateAckDetails(item, depth + 1);
  }
}
export async function ackGatewayCommand(
  tx: Tx,
  machineId: Id,
  id: Id,
  input: GatewayAck,
  now: Date,
): Promise<GatewayCommand> {
  const [row] =
    await tx`select * from gateway_commands where id=${id} and machine_id=${machineId} for update`;
  if (!row) fail('NOT_FOUND', 404);
  if ((input.phase === 'completed') !== (input.result !== undefined)) fail('INVALID_INPUT', 400);
  if (input.result?.details) validateAckDetails(input.result.details);
  if (row.state === 'completed') {
    if (input.phase === 'completed' && !same(row.result, input.result)) fail('COMMAND_ACK_CONFLICT');
    return mapCommand(row);
  }
  if (row.state === 'received' && input.phase === 'received') return mapCommand(row);
  const [updated] =
    await tx`update gateway_commands set state=${input.phase},received_at=coalesce(received_at,${now}),completed_at=${input.phase === 'completed' ? now : null},result=${input.result ? tx.json(json(input.result)) : null} where id=${id} returning *`;
  await event(tx, machineId, 'gateway.command.acknowledged', { commandId: id, phase: input.phase });
  return mapCommand(updated as Record<string, unknown>);
}
export async function readGatewayStatus(tx: Tx, machineId: Id, now: Date): Promise<GatewayStatus> {
  const [machine] = await tx`select id from machines where id=${machineId}`;
  if (!machine) fail('NOT_FOUND', 404);
  const desiredConfig = await readGatewayConfig(tx, machineId),
    applied = await readGatewayApplied(tx, machineId);
  const [boot] =
    await tx`select boot_id,boot_generation from gateway_boots where machine_id=${machineId} and retired_at is null`;
  const [last] = await tx`select * from gateway_heartbeats where machine_id=${machineId}`;
  const live = !!last && !!boot && last.boot_id === boot.boot_id;
  const receivedAt = live ? (last.received_at as Date).toISOString() : null;
  const online = live && now.getTime() - (last.received_at as Date).getTime() <= 60_000;
  const processes = live ? (last.processes as GatewayHeartbeat['processes']) : [];
  const commands =
    await tx`select * from gateway_commands where machine_id=${machineId} and state<>'completed' order by cursor limit 100`;
  return {
    machineId,
    bootId: (boot?.boot_id as Id) ?? null,
    bootGeneration: boot ? String(boot.boot_generation) : null,
    serverConnection: !boot ? 'unconfigured' : online ? 'online' : 'offline',
    desiredConfigRevision: desiredConfig?.revision ?? null,
    appliedConfigRevision: applied?.revision ?? null,
    desiredConfig,
    applied,
    workflows: applied?.workflows ?? (last?.inventory as WorkflowInventory | undefined) ?? missingInventory(),
    receivedAt,
    lastTelemetryAt: receivedAt,
    hostVersion: live ? String(last.host_version) : null,
    appVersion: live && last.app_version !== null ? String(last.app_version) : null,
    observedAt: live && last.observed_at ? new Date(last.observed_at as Date).toISOString() : null,
    telemetry: live ? (last.telemetry as GatewayHeartbeat['telemetry']) : null,
    activeProcesses: processes.filter((p) => p.observation === 'running'),
    uncertainProcesses: processes.filter((p) => p.observation === 'unknown'),
    commands: commands.map(mapCommand),
  };
}
/** Owner history of machine commands, newest first, with their completion result; keyset on the 007 cursor. */
export async function listMachineCommands(
  tx: Tx,
  machineId: Id,
  before: string | undefined,
  limit: number,
): Promise<{ items: GatewayCommand[]; nextBefore: string | null }> {
  if (before !== undefined) parseCursor(before);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('LIMIT_INVALID', 400);
  const [machine] = await tx`select id from machines where id=${machineId}`;
  if (!machine) fail('NOT_FOUND', 404);
  const rows =
    before === undefined
      ? await tx`select * from gateway_commands where machine_id=${machineId} order by cursor desc limit ${limit + 1}`
      : await tx`select * from gateway_commands where machine_id=${machineId} and cursor<${before} order by cursor desc limit ${limit + 1}`;
  const items = rows.slice(0, limit).map(mapCommand);
  return { items, nextBefore: rows.length > limit ? (items.at(-1)?.cursor ?? null) : null };
}
/**
 * Server-side heuristic: a `received` command is treated as abandoned after 5 minutes. This is not a
 * contract with the daemon, which has no matching lease or timeout; its backoff of at most 75s is only
 * the pause between attempts.
 */
export const RECEIVED_COMMAND_LEASE_MS = 5 * 60_000;
/**
 * Owner retry/reinstall intent for the current desired revision. Config PUT is a no-op when desired is
 * unchanged, so this queues one more sync_workflows for the same revision. A queued command, or a received one still
 * inside the lease, is returned instead of stacking duplicates. A disabled config fails closed.
 */
export async function requestWorkflowRetry(
  tx: Tx,
  machineId: Id,
  input: { expectedRevision: number; runtime?: Runtime },
  now: Date,
): Promise<WorkflowRetryResult> {
  const config = await readGatewayConfig(tx, machineId);
  if (!config) fail('CONFIG_NOT_CONFIGURED');
  if (config.revision !== input.expectedRevision) fail('CONFIG_REVISION_CONFLICT');
  if (input.runtime ? !(await isSourceEnabled(tx, machineId, input.runtime)) : !config.enabled)
    fail('CONFIG_DISABLED');
  const staleBefore = new Date(now.getTime() - RECEIVED_COMMAND_LEASE_MS);
  const [open] =
    await tx`select * from gateway_commands where machine_id=${machineId} and type='sync_workflows' and (state='queued' or (state='received' and received_at>${staleBefore})) and (payload->>'configRevision')::int=${config.revision} order by cursor desc limit 1`;
  if (open) return { created: false, configRevision: config.revision, command: mapCommand(open) };
  const [cursor] = await tx`update gateway_command_cursor set value=value+1 where singleton returning value`;
  const commandId = randomUUID();
  const [row] =
    await tx`insert into gateway_commands(id,machine_id,type,payload,state,created_at,cursor) values(${commandId},${machineId},'sync_workflows',${tx.json({ configRevision: config.revision })},'queued',${now},${cursor?.value}) returning *`;
  await event(tx, machineId, 'gateway.command.created', { commandId, type: 'sync_workflows' });
  return {
    created: true,
    configRevision: config.revision,
    command: mapCommand(row as Record<string, unknown>),
  };
}

async function lockCurrentAttempt(
  tx: Tx,
  id: Id,
  actor: Actor,
  input: ProjectionInput,
): Promise<Record<string, unknown>> {
  const [row] =
    await tx`select a.*,g.active_attempt_id from attempts a join execution_guards g on g.ticket_id=a.ticket_id where a.id=${id} for update of a,g`;
  if (!row || actor.kind !== 'machine' || row.machine_id !== actor.id) fail('NOT_FOUND', 404);
  if (
    String(row.fence) !== input.fence ||
    row.process_instance_id !== input.processInstanceId ||
    row.active_attempt_id !== id ||
    !['active', 'uncertain'].includes(String(row.state))
  )
    fail('STALE_FENCE');
  return row;
}
function mapProjection(row: Record<string, unknown>): AttemptProjectionPin {
  return {
    attemptId: row.attempt_id as Id,
    fence: String(row.fence),
    processInstanceId: row.process_instance_id as Id,
    sourceTreeSha256: String(row.source_tree_sha256),
    runtime: row.runtime as AttemptProjectionPin['runtime'],
    projectionManifestSha256: String(row.projection_manifest_sha256),
    projectionTreeSha256: String(row.projection_tree_sha256),
    installReportId: row.install_report_id as Id,
  };
}
export async function saveAttemptProjection(
  tx: Tx,
  id: Id,
  input: ProjectionInput,
  actor: Actor,
  policy: GatewayProjectionPolicy,
  now: Date,
): Promise<AttemptProjectionPin> {
  const attempt = await lockCurrentAttempt(tx, id, actor, input);
  const [existing] = await tx`select * from gateway_attempt_projections where attempt_id=${id}`;
  const requested = { attemptId: id, ...input };
  if (existing) {
    const prior = mapProjection(existing);
    if (!same(prior, requested)) fail('SELECTION_MISMATCH');
    return prior;
  }
  const selected = await policy.authorize(tx, { attemptId: id, actor });
  if (
    !selected ||
    input.runtime !== selected.runtime ||
    input.sourceTreeSha256 !== selected.sourceTreeSha256 ||
    input.projectionManifestSha256 !== selected.projectionManifestSha256 ||
    input.projectionTreeSha256 !== selected.projectionTreeSha256 ||
    input.installReportId !== selected.installReportId
  )
    fail('SELECTION_MISMATCH');
  const [command] = await tx`select * from commands where id=${attempt.command_id as Id} for share`;
  const [decision] = await tx`select * from decisions where id=${selected.decisionId} for share`;
  const commandSelection = (command?.payload as { selection?: unknown } | undefined)?.selection;
  const decisionSelection = (decision?.scope as { selection?: unknown } | undefined)?.selection;
  if (
    !command ||
    command.machine_id !== actor.id ||
    command.ticket_id !== attempt.ticket_id ||
    !decision ||
    decision.kind !== 'dispatch' ||
    decision.ticket_id !== attempt.ticket_id ||
    !commandSelection ||
    !decisionSelection ||
    !same(commandSelection, selected) ||
    !same(decisionSelection, selected)
  )
    fail('SELECTION_MISMATCH');
  const [report] =
    await tx`select * from gateway_install_reports where id=${selected.installReportId} and machine_id=${actor.id}`;
  const response = report?.response as InstallReportResponse | undefined;
  if (
    !report ||
    !response?.accepted ||
    Number(report.config_revision) !== selected.configRevision ||
    response.appliedRevision !== selected.configRevision
  )
    fail('SELECTION_MISMATCH');
  const pin = attempt.workflow_pin as ReturnType<typeof toDomainPin>;
  if (!workflows.includes(pin.workflow)) fail('WORKFLOW_PIN_MISMATCH');
  const status = response.workflows[pin.workflow];
  const source = status.source.installed,
    projection = status.projections[selected.runtime].installed;
  if (
    status.source.state !== 'current' ||
    !source ||
    !samePin(pin, toDomainPin(source)) ||
    source.sourceTreeSha256 !== input.sourceTreeSha256 ||
    status.projections[selected.runtime].state !== 'current' ||
    !projection ||
    projection.runtime !== selected.runtime ||
    projection.sourceTreeSha256 !== input.sourceTreeSha256 ||
    projection.manifestSha256 !== input.projectionManifestSha256 ||
    projection.treeSha256 !== input.projectionTreeSha256
  )
    fail('WORKFLOW_PIN_MISMATCH');
  await tx`insert into gateway_attempt_projections(attempt_id,machine_id,install_report_id,fence,process_instance_id,source_tree_sha256,runtime,projection_manifest_sha256,projection_tree_sha256,created_at) values(${id},${actor.id},${input.installReportId},${input.fence},${input.processInstanceId},${input.sourceTreeSha256},${input.runtime},${input.projectionManifestSha256},${input.projectionTreeSha256},${now})`;
  return requested;
}
