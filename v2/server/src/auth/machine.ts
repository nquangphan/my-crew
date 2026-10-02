import { randomUUID } from 'node:crypto';
import { appendEvent } from '../journal/events.ts';
import type { Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import { randomSecret, sha256 } from './session.ts';

export type Machine = { id: Id; name: string; revokedAt: string | null };

export async function provisionMachine(tx: Tx, name: string): Promise<{ machine: Machine; token: string }> {
  if (typeof name !== 'string' || name.length < 1 || name.length > 200) {
    throw new ApiError('VALIDATION', 400, 'Tên máy không hợp lệ');
  }
  const id = randomUUID();
  const token = randomSecret();
  await tx`insert into machines (id, name, token_hash) values (${id}, ${name}, ${sha256(token)})`;
  await appendEvent(tx, {
    type: 'machine.provisioned',
    projectId: null,
    ticketId: null,
    audienceMachineId: null,
    data: { machineId: id },
  });
  return { machine: { id, name, revokedAt: null }, token };
}
