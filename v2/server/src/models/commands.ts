import type { GatewayAck } from '../gateway/contracts.ts';
import { ackGatewayCommand, listGatewayCommands } from '../gateway/service.ts';
import type { Id, Tx } from '../platform/contracts.ts';
import type { ModelCommand } from './contracts.ts';
import { fail, same } from './helpers.ts';
export async function readModelCommands(tx: Tx, machineId: Id, after: string, limit: number) {
  const page = await listGatewayCommands(tx, machineId, after, limit);
  return { ...page, items: page.items as ModelCommand[] };
}
export async function ackModelCommand(
  tx: Tx,
  machineId: Id,
  id: Id,
  input: GatewayAck,
  now = new Date(),
): Promise<ModelCommand> {
  const [row] =
    await tx`select * from gateway_commands where id=${id} and machine_id=${machineId} for update`;
  if (row?.type !== 'sync_models') fail('NOT_FOUND', 404);
  if (input.phase === 'completed' && row.state !== 'completed') {
    const superseded = same(input.result, { ok: false, code: 'SUPERSEDED' });
    const [valid] = superseded
      ? await tx`select 1 from model_source_configs where machine_id=${machineId} and revision>${(row.payload as { configRevision: number }).configRevision}`
      : await tx`select 1 from model_source_applied a join gateway_boots b on b.machine_id=a.machine_id and b.boot_generation=a.boot_generation and b.retired_at is null where a.machine_id=${machineId} and a.revision=${(row.payload as { configRevision: number }).configRevision}`;
    if (!valid) fail(superseded ? 'CONFIG_REVISION_CONFLICT' : 'MODEL_CONFIG_PENDING');
  }
  return (await ackGatewayCommand(tx, machineId, id, input, now)) as ModelCommand;
}
