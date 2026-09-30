import { createHash, randomInt } from 'node:crypto';
import {
  type HeartbeatRequest as HeartbeatInput,
  HeartbeatRequest,
  type HeartbeatResponse,
  MACHINE_TOKEN_TTL_DAYS,
  type Machine,
  type MachineDetailResponse,
  type MachineTokenResponse,
  PAIRING_CODE_TTL_MINUTES,
  type PairingCodeResponse,
  type PairMachineRequest as PairMachineInput,
  PairMachineRequest,
  type PutSkillsRequest as PutSkillsInput,
  PutSkillsRequest,
  type SkillInventory,
} from '@crew/shared';
import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { MachineContext } from '../auth/machine-auth.js';
import { generateMachineToken, hashMachineToken } from '../auth/machine-auth.js';
import { verifyOwnerTotp } from '../auth/owner-auth.js';
import type { Executor } from '../db/client.js';
import {
  type MachineRow,
  machineSkills,
  machines,
  machineTokens,
  pairingCodes,
  projects,
} from '../db/schema.js';
import { ApiError, notFound } from '../errors.js';
import type { EventBus } from '../realtime/event-bus.js';
import { activitySignatures, changedTicketIds, heartbeatFresh } from './agent-activity-service.js';
import { releaseEverything } from './claim-service.js';
import { appendEvents } from './event-service.js';
import { expectedRevisions } from './settings-service.js';

export const PAIRING_CODE_TTL_MS = PAIRING_CODE_TTL_MINUTES * 60 * 1000;
export const MACHINE_TOKEN_TTL_MS = MACHINE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
/**
 * After a rotation the old token keeps working this long, so a daemon that crashed before saving the new
 * token can rotate again instead of re-pairing. Streams on the old token close at the first heartbeat after.
 */
export const ROTATION_GRACE_MS = 10 * 60 * 1000;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const normalizePairingCode = (code: string) => code.trim().toUpperCase().replaceAll('-', '');

// ---------------------------------------------------------------------------
// Pairing and tokens
// ---------------------------------------------------------------------------

/** Owner creates a single-use pairing code after re-confirming the TOTP. Only its hash is stored. */
export async function createPairingCode(
  db: Executor,
  ownerId: string,
  totpCode: string,
): Promise<PairingCodeResponse> {
  if (!(await verifyOwnerTotp(db, ownerId, totpCode))) {
    throw new ApiError('UNAUTHORIZED', 'invalid verification code');
  }
  const raw = Array.from({ length: 12 }, () => BASE32[randomInt(BASE32.length)]).join('');
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
  await db.insert(pairingCodes).values({ codeHash: sha256(raw), expiresAt });
  return { pairingCode: raw.match(/.{4}/g)?.join('-') ?? raw, expiresAt: expiresAt.toISOString() };
}

async function issueToken(tx: Executor, machineId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateMachineToken();
  const expiresAt = new Date(Date.now() + MACHINE_TOKEN_TTL_MS);
  await tx.insert(machineTokens).values({ machineId, tokenHash: hashMachineToken(token), expiresAt });
  return { token, expiresAt };
}

async function saveInventory(
  tx: Executor,
  machineId: string,
  projectId: string | null,
  inventory: SkillInventory,
): Promise<void> {
  const values = { skills: inventory.skills, mcpServers: inventory.mcpServers, updatedAt: new Date() };
  await tx
    .insert(machineSkills)
    .values({ machineId, projectId, ...values })
    .onConflictDoUpdate({ target: [machineSkills.machineId, machineSkills.projectId], set: values });
}

/**
 * Required skills and MCP servers of a new ticket must be in the inventory the project's machine reported
 * (the project inventory plus the machine-level one), and an MCP server the owner switched off for the
 * project cannot be required. Unknown names are refused with the lists in `details`. The UI-test MCP
 * servers the server adds to QC tickets itself are not checked here: QC blocks when they are missing.
 */
export async function assertKnownCapabilities(
  tx: Executor,
  input: { projectId: string | null; skills: readonly string[]; mcps: readonly string[] },
): Promise<void> {
  if (input.skills.length + input.mcps.length === 0) return;
  const [project] = input.projectId
    ? await tx
        .select({ id: projects.id, ownerMachineId: projects.ownerMachineId })
        .from(projects)
        .where(eq(projects.id, input.projectId))
    : [];
  if (!project?.ownerMachineId) {
    throw new ApiError('VALIDATION_FAILED', 'required skills need a project owned by a machine');
  }
  const rows = await tx
    .select()
    .from(machineSkills)
    .where(
      and(
        eq(machineSkills.machineId, project.ownerMachineId),
        or(eq(machineSkills.projectId, project.id), isNull(machineSkills.projectId)),
      ),
    );
  if (rows.length === 0) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'the project machine has not reported its skill and MCP inventory yet; required skills cannot be checked',
    );
  }
  const skills = new Set(rows.flatMap((row) => row.skills.map((skill) => skill.name)));
  const mcps = new Set(
    rows.flatMap((row) => row.mcpServers.filter((server) => !server.disabled).map((server) => server.name)),
  );
  const unknownSkills = input.skills.filter((name) => !skills.has(name));
  const unknownMcps = input.mcps.filter((name) => !mcps.has(name));
  if (unknownSkills.length + unknownMcps.length > 0) {
    throw new ApiError(
      'VALIDATION_FAILED',
      `not in the machine inventory (or disabled): ${[...unknownSkills, ...unknownMcps].join(', ')}`,
      { unknownSkills, unknownMcps },
    );
  }
}

/**
 * Pairs a new machine with a single-use code and returns its token once. The code authenticates the machine
 * only; projects and the assistant role are claimed afterwards from the local app.
 */
export async function pairMachine(db: Executor, input: PairMachineInput): Promise<MachineTokenResponse> {
  const data = PairMachineRequest.parse(input);
  return db.transaction(async (tx) => {
    const [code] = await tx
      .update(pairingCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(pairingCodes.codeHash, sha256(normalizePairingCode(data.code))),
          isNull(pairingCodes.usedAt),
          gt(pairingCodes.expiresAt, sql`now()`),
        ),
      )
      .returning({ id: pairingCodes.id });
    if (!code) throw new ApiError('UNAUTHORIZED', 'invalid, used or expired pairing code');

    const [machine] = await tx
      .insert(machines)
      .values({
        name: data.name,
        hostname: data.hostname,
        os: data.os,
        hardware: data.hardware,
        online: true,
        lastSeenAt: new Date(),
      })
      .returning({ id: machines.id });
    if (!machine) throw new Error('machine insert returned no row');
    await tx.update(pairingCodes).set({ machineId: machine.id }).where(eq(pairingCodes.id, code.id));
    if (data.inventory) await saveInventory(tx, machine.id, null, data.inventory);

    const { token, expiresAt } = await issueToken(tx, machine.id);
    return { machineId: machine.id, token, expiresAt: expiresAt.toISOString() };
  });
}

/** Swaps the calling token for a new one; the old token stays valid for ROTATION_GRACE_MS at most. */
export async function rotateToken(db: Executor, machine: MachineContext): Promise<MachineTokenResponse> {
  return db.transaction(async (tx) => {
    const { token, expiresAt } = await issueToken(tx, machine.machineId);
    const graceEnd = new Date(Date.now() + ROTATION_GRACE_MS);
    await tx
      .update(machineTokens)
      .set({ expiresAt: sql`least(${machineTokens.expiresAt}, ${graceEnd.toISOString()}::timestamptz)` })
      .where(eq(machineTokens.id, machine.tokenId));
    return { machineId: machine.machineId, token, expiresAt: expiresAt.toISOString() };
  });
}

/**
 * Revokes a machine: all its tokens, its claims (its projects and the assistant role become unowned) and
 * its pending requests. Its open streams are closed before the commit, so no later event reaches it.
 */
export async function revokeMachine(db: Executor, bus: EventBus, machineId: string): Promise<Machine> {
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(machines).where(eq(machines.id, machineId));
      if (!row) throw notFound('machine');
      if (row.revokedAt) return;
      // Claim scopes are locked before machine rows everywhere, so this takes no machine row lock first.
      const events = await releaseEverything(tx, machineId);
      await tx
        .update(machines)
        .set({ revokedAt: new Date(), online: false, hostsAssistant: false })
        .where(eq(machines.id, machineId));
      await tx
        .update(machineTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(machineTokens.machineId, machineId), isNull(machineTokens.revokedAt)));
      await appendEvents(tx, events);
      bus.revokeMachine(machineId);
    });
  } catch (error) {
    bus.restoreMachine(machineId);
    throw error;
  }
  return (await getMachineDetail(db, bus, machineId)).machine;
}

// ---------------------------------------------------------------------------
// Heartbeat and inventory
// ---------------------------------------------------------------------------

/**
 * Stores the latest machine state. A health summary that turns red (from anything else) sends a
 * `machine.unhealthy` alert to the owner stream once. When the reported job activity of any ticket changed
 * (or the machine was silent long enough for its old report to read as unknown), one
 * `agent.activity_changed` names those tickets, so the web refetches them.
 */
export async function recordHeartbeat(
  db: Executor,
  machine: MachineContext,
  input: HeartbeatInput,
): Promise<HeartbeatResponse> {
  const data = HeartbeatRequest.parse(input);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        health: machines.health,
        online: machines.online,
        lastHeartbeatAt: machines.lastHeartbeatAt,
        runningJobs: machines.runningJobs,
        waitingJobs: machines.waitingJobs,
        failedJobs: machines.failedJobs,
        settingsState: machines.settingsState,
      })
      .from(machines)
      .where(eq(machines.id, machine.machineId))
      .for('update');
    if (!row) throw notFound('machine');
    const before = activitySignatures(row);
    const after = activitySignatures(data);
    // A stale report already reads as unknown: every ticket it or this one names changes on the web.
    const changed = heartbeatFresh(row)
      ? changedTicketIds(before, after)
      : [...new Set([...before.keys(), ...after.keys()])];
    await tx
      .update(machines)
      .set({
        resources: data.resources,
        runningJobs: data.runningJobs,
        waitingJobs: data.waitingJobs,
        failedJobs: data.failedJobs,
        cliVersion: data.cliVersion,
        ...(data.appVersion ? { appVersion: data.appVersion } : {}),
        paused: data.paused,
        ...(data.health ? { health: data.health } : {}),
        ...(data.settings ? { settingsState: data.settings } : {}),
        online: true,
        lastSeenAt: sql`now()`,
        lastHeartbeatAt: sql`now()`,
      })
      .where(eq(machines.id, machine.machineId));
    if (data.health?.status === 'red' && row.health?.status !== 'red') {
      await appendEvents(tx, [
        {
          payload: {
            type: 'machine.unhealthy',
            data: { machineId: machine.machineId, failing: data.health.failing },
          },
        },
      ]);
    }
    if (data.settings && data.settings.revision !== row.settingsState?.revision) {
      await appendEvents(tx, [
        {
          payload: {
            type: 'machine.settings_applied',
            data: { machineId: machine.machineId, revision: data.settings.revision },
          },
        },
      ]);
    }
    if (changed.length > 0) {
      await appendEvents(tx, [
        {
          payload: {
            type: 'agent.activity_changed',
            data: { machineId: machine.machineId, ticketIds: changed },
          },
        },
      ]);
    }
    return { serverTime: new Date().toISOString(), tokenExpiresAt: machine.tokenExpiresAt.toISOString() };
  });
}

/** Replaces the skill and MCP inventory of one owned project, or the machine-level inventory. */
export async function putInventory(db: Executor, machineId: string, input: PutSkillsInput): Promise<void> {
  const data = PutSkillsRequest.parse(input);
  let projectId: string | null = null;
  if (data.projectKey !== null) {
    const [project] = await db
      .select({ id: projects.id, owner: projects.ownerMachineId })
      .from(projects)
      .where(eq(projects.key, data.projectKey));
    if (!project) throw notFound('project');
    if (project.owner !== machineId) {
      throw new ApiError('FORBIDDEN', `project ${data.projectKey} belongs to another machine`);
    }
    projectId = project.id;
  }
  await saveInventory(db, machineId, projectId, data);
}

// ---------------------------------------------------------------------------
// Owner views
// ---------------------------------------------------------------------------

function toMachineDto(
  row: MachineRow,
  extras: {
    streamConnected: boolean;
    tokenExpiresAt: Date | null;
    projectKeys: string[];
    expectedRevision: string;
  },
): Machine {
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    os: row.os,
    hardware: row.hardware,
    hostsAssistant: row.hostsAssistant,
    online: row.online,
    streamConnected: extras.streamConnected,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    paused: row.paused,
    health: row.health,
    resources: row.resources,
    runningJobs: row.runningJobs,
    waitingJobs: row.waitingJobs,
    failedJobs: row.failedJobs,
    cliVersion: row.cliVersion,
    appVersion: row.appVersion,
    tokenExpiresAt: extras.tokenExpiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    projectKeys: extras.projectKeys,
    settings: {
      reported: row.settingsState,
      expectedRevision: extras.expectedRevision,
      current: row.settingsState?.revision === extras.expectedRevision,
    },
    createdAt: row.createdAt.toISOString(),
  };
}

async function machineDtos(db: Executor, bus: EventBus, rows: MachineRow[]): Promise<Machine[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [expiries, owned, expected] = await Promise.all([
    db
      .select({
        machineId: machineTokens.machineId,
        expiresAt: sql<string>`max(${machineTokens.expiresAt})::text`,
      })
      .from(machineTokens)
      .where(
        and(
          inArray(machineTokens.machineId, ids),
          isNull(machineTokens.revokedAt),
          gt(machineTokens.expiresAt, sql`now()`),
        ),
      )
      .groupBy(machineTokens.machineId),
    db
      .select({ owner: projects.ownerMachineId, key: projects.key })
      .from(projects)
      .where(inArray(projects.ownerMachineId, ids))
      .orderBy(asc(projects.key)),
    expectedRevisions(db, ids),
  ]);
  const expiryOf = new Map(expiries.map((e) => [e.machineId, new Date(e.expiresAt)]));
  return rows.map((row) =>
    toMachineDto(row, {
      streamConnected: bus.isConnected(row.id),
      tokenExpiresAt: expiryOf.get(row.id) ?? null,
      projectKeys: owned.filter((p) => p.owner === row.id).map((p) => p.key),
      expectedRevision: expected.get(row.id) ?? '',
    }),
  );
}

export async function listMachines(db: Executor, bus: EventBus): Promise<Machine[]> {
  const rows = await db.select().from(machines).orderBy(asc(machines.createdAt));
  return machineDtos(db, bus, rows);
}

export async function getMachineDetail(
  db: Executor,
  bus: EventBus,
  machineId: string,
): Promise<MachineDetailResponse> {
  const [row] = await db.select().from(machines).where(eq(machines.id, machineId));
  if (!row) throw notFound('machine');
  const [[machine], inventories] = await Promise.all([
    machineDtos(db, bus, [row]),
    db
      .select({ inventory: machineSkills, projectKey: projects.key })
      .from(machineSkills)
      .leftJoin(projects, eq(projects.id, machineSkills.projectId))
      .where(eq(machineSkills.machineId, machineId))
      .orderBy(asc(projects.key)),
  ]);
  if (!machine) throw notFound('machine');
  return {
    machine,
    inventories: inventories.map(({ inventory, projectKey }) => ({
      projectId: inventory.projectId,
      projectKey,
      skills: inventory.skills,
      mcpServers: inventory.mcpServers,
      updatedAt: inventory.updatedAt.toISOString(),
    })),
  };
}
