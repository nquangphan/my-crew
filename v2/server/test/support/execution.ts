import { randomUUID } from 'node:crypto';
import { connectDb } from '../../src/db/client.ts';
import { createCommand } from '../../src/execution/commands.ts';
import type { Actor, Db, DispatchPermit, Tx } from '../../src/platform/contracts.ts';
import { ticketFixture } from './tickets.ts';

export const pin = {
  workflow: 'superpowers',
  version: '1',
  revision: '1',
  checksum: 'a'.repeat(64),
} as const;
export async function openPeerDb(db: Db): Promise<Db> {
  const baseUrl = process.env.CREW_V2_TEST_DATABASE_URL;
  if (!baseUrl) throw new Error('CREW_V2_TEST_DATABASE_URL_REQUIRED');
  const [row] = await db`select current_database() as name`;
  if (typeof row?.name !== 'string' || !/^crew_v2_test_[0-9a-f]{32}$/.test(row.name))
    throw new Error('UNSAFE_TEST_DATABASE');
  const url = new URL(baseUrl);
  url.pathname = `/${row.name}`;
  return connectDb(url.toString());
}
export async function executionFixture(db: Db) {
  const f = await ticketFixture(db);
  const machineId = randomUUID();
  const actor: Actor = { kind: 'machine', id: machineId };
  await db`insert into machines(id,name,token_hash) values(${machineId},'test',${'b'.repeat(64)})`;
  await db`update projects set machine_id=${machineId},checkout_path='/tmp/crew',binding_revision=2 where id=${f.project.id}`;
  await db`update tickets set status='ready',workflow_pin=${db.json(pin)} where id=${f.a.id}`;
  const [ticket] = await db`select revision from tickets where id=${f.a.id}`;
  const command = await db.begin((tx) =>
    createCommand(
      tx,
      { machineId, ticketId: f.a.id, type: 'start', payload: {} },
      { kind: 'owner', id: 'owner' },
    ),
  );
  const permit: DispatchPermit = {
    commandId: command.id,
    ticketId: f.a.id,
    machineId,
    bindingRevision: 2,
    ticketRevision: Number(ticket?.revision),
    workflow: pin,
    checkedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 20_000).toISOString(),
    telemetryId: randomUUID(),
    decisionId: randomUUID(),
  };
  const authorize = async (_tx: Tx) => {};
  return { f, actor, command, permit, authorize };
}
