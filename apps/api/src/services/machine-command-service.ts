import {
  MACHINE_COMMAND_RESULT,
  MACHINE_COMMAND_TTL_MS,
  type MachineCommand,
  type MachineCommandAction,
  type MachineCommandParsed,
  type MachineCommandResultRequest,
  type MachineCommandStatus,
} from '@crew/shared';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { MachineContext } from '../auth/machine-auth.js';
import type { Executor } from '../db/client.js';
import { type MachineCommandRow, machineCommands, machines } from '../db/schema.js';
import { ApiError, notFound } from '../errors.js';
import { appendEvents } from './event-service.js';

export function toCommandDto(row: MachineCommandRow): MachineCommand {
  return {
    id: row.id,
    machineId: row.machineId,
    action: row.action as MachineCommandAction,
    params: row.params,
    status: row.status,
    result: row.result ?? null,
    error: row.error,
    requestedBy: row.requestedBy,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

const updated = (row: MachineCommandRow) => ({
  payload: {
    type: 'machine.command_updated' as const,
    data: { commandId: row.id, machineId: row.machineId, status: row.status },
  },
});

/** Marks the machine's pending commands that nobody started in time as expired (and tells the owner). */
async function expireStale(tx: Executor, machineId: string): Promise<void> {
  const rows = await tx
    .update(machineCommands)
    .set({ status: 'expired', finishedAt: new Date() })
    .where(
      and(
        eq(machineCommands.machineId, machineId),
        eq(machineCommands.status, 'pending'),
        lt(machineCommands.createdAt, sql`now() - make_interval(secs => ${MACHINE_COMMAND_TTL_MS / 1000})`),
      ),
    )
    .returning();
  await appendEvents(tx, rows.map(updated));
}

/**
 * The owner asks a live machine for one whitelisted action (already validated with the shared schema). The
 * machine hears it on its event stream; the owner stream is told too.
 */
export async function createMachineCommand(
  db: Executor,
  input: { machineId: string; request: MachineCommandParsed; requestedBy: string },
): Promise<MachineCommand> {
  return db.transaction(async (tx) => {
    const [machine] = await tx
      .select({ id: machines.id, revokedAt: machines.revokedAt })
      .from(machines)
      .where(eq(machines.id, input.machineId));
    if (!machine) throw notFound('machine');
    if (machine.revokedAt) throw new ApiError('CONFLICT', 'the machine was revoked');
    await expireStale(tx, input.machineId);
    const { action, ...params } = input.request;
    const [row] = await tx
      .insert(machineCommands)
      .values({ machineId: input.machineId, action, params, requestedBy: input.requestedBy })
      .returning();
    if (!row) throw new Error('machine command insert returned no row');
    const data = { commandId: row.id, machineId: row.machineId, action: row.action };
    await appendEvents(tx, [
      { payload: { type: 'machine.command', data } },
      { payload: { type: 'machine.command', data }, targetMachineId: row.machineId },
    ]);
    return toCommandDto(row);
  });
}

/** The machine's newest commands (expired ones marked as such). */
export async function listMachineCommands(
  db: Executor,
  machineId: string,
  limit = 20,
): Promise<MachineCommand[]> {
  return db.transaction(async (tx) => {
    await expireStale(tx, machineId);
    const rows = await tx
      .select()
      .from(machineCommands)
      .where(eq(machineCommands.machineId, machineId))
      .orderBy(desc(machineCommands.createdAt))
      .limit(limit);
    return rows.map(toCommandDto);
  });
}

export async function getMachineCommand(
  db: Executor,
  machineId: string,
  id: string,
): Promise<MachineCommand> {
  return db.transaction(async (tx) => {
    await expireStale(tx, machineId);
    const [row] = await tx
      .select()
      .from(machineCommands)
      .where(and(eq(machineCommands.id, id), eq(machineCommands.machineId, machineId)));
    if (!row) throw notFound('machine command');
    return toCommandDto(row);
  });
}

async function lockCommand(tx: Executor, machine: MachineContext, id: string): Promise<MachineCommandRow> {
  const [row] = await tx
    .select()
    .from(machineCommands)
    .where(and(eq(machineCommands.id, id), eq(machineCommands.machineId, machine.machineId)))
    .for('update');
  if (!row) throw notFound('machine command');
  return row;
}

/**
 * The daemon takes a command: pending → running. A command left pending past MACHINE_COMMAND_TTL_MS expires
 * instead (409); one already running is returned as is (a retried start).
 */
export async function startMachineCommand(
  tx: Executor,
  machine: MachineContext,
  id: string,
): Promise<MachineCommand> {
  const row = await lockCommand(tx, machine, id);
  if (row.status === 'running') return toCommandDto(row);
  if (row.status !== 'pending') {
    throw new ApiError('CONFLICT', `the command is ${row.status}`, { status: row.status });
  }
  const age = Date.now() - row.createdAt.getTime();
  const next: { status: MachineCommandStatus; at: Date } =
    age > MACHINE_COMMAND_TTL_MS
      ? { status: 'expired', at: new Date() }
      : { status: 'running', at: new Date() };
  const [changed] = await tx
    .update(machineCommands)
    .set(
      next.status === 'running'
        ? { status: 'running', startedAt: next.at }
        : { status: 'expired', finishedAt: next.at },
    )
    .where(eq(machineCommands.id, row.id))
    .returning();
  if (!changed) throw new Error('machine command update returned no row');
  await appendEvents(tx, [updated(changed)]);
  if (changed.status === 'expired') {
    // Committed with the refusal, so the owner sees the command expired.
    throw new ApiError(
      'CONFLICT',
      'the command expired before the machine took it',
      { status: 'expired' },
      true,
    );
  }
  return toCommandDto(changed);
}

/**
 * The daemon reports the outcome of a running command. A result of the wrong shape for the action is stored
 * as a failure. A retried report of a finished command returns it unchanged.
 */
export async function finishMachineCommand(
  tx: Executor,
  machine: MachineContext,
  id: string,
  outcome: MachineCommandResultRequest,
): Promise<MachineCommand> {
  const row = await lockCommand(tx, machine, id);
  if (row.status === 'done' || row.status === 'failed') return toCommandDto(row);
  if (row.status !== 'running') {
    throw new ApiError('CONFLICT', `the command is ${row.status}`, { status: row.status });
  }
  let patch: { status: 'done'; result: unknown } | { status: 'failed'; error: string };
  if (outcome.ok) {
    const schema = MACHINE_COMMAND_RESULT[row.action as MachineCommandAction];
    const parsed = schema?.safeParse(outcome.result);
    patch = parsed?.success
      ? { status: 'done', result: parsed.data }
      : { status: 'failed', error: 'Máy trả về kết quả không đúng dạng của thao tác này.' };
  } else {
    patch = { status: 'failed', error: outcome.error };
  }
  const [changed] = await tx
    .update(machineCommands)
    .set({ ...patch, finishedAt: new Date() })
    .where(eq(machineCommands.id, row.id))
    .returning();
  if (!changed) throw new Error('machine command update returned no row');
  await appendEvents(tx, [updated(changed)]);
  return toCommandDto(changed);
}
