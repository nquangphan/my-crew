import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { Id, Tx } from '../platform/contracts.ts';
import type { ApiProviderConfig, SourceConfig, SourceConfigInput } from './contracts.ts';
import { fail, json, modelEvent, same } from './helpers.ts';
export function validateApiEndpoint(p: Omit<ApiProviderConfig, 'credentialStatus'>): void {
  let u: URL;
  try {
    u = new URL(p.endpoint);
  } catch {
    fail('ENDPOINT_INVALID', 400);
  }
  if (u.href !== p.endpoint || u.username || u.password || u.search || u.hash) fail('ENDPOINT_INVALID', 400);
  if (u.protocol === 'http:') {
    if (
      !p.localHttp ||
      !['127.0.0.1', '[::1]'].includes(u.hostname) ||
      !u.port ||
      Number(u.port) < 1 ||
      Number(u.port) > 65535 ||
      p.localHttp.allowedOrigin !== u.origin
    )
      fail('ENDPOINT_INVALID', 400);
  } else if (
    u.protocol !== 'https:' ||
    p.localHttp ||
    isIP(u.hostname.replaceAll(/[[\]]/g, '')) ||
    u.hostname === 'localhost' ||
    u.hostname.endsWith('.localhost') ||
    u.hostname.endsWith('.local')
  )
    fail('ENDPOINT_INVALID', 400);
  if (!p.models.length || new Set(p.models.map((m) => m.id)).size !== p.models.length)
    fail('MODEL_LIST_INVALID', 400);
}
export async function readSourceConfig(tx: Tx, machineId: Id): Promise<SourceConfig | null> {
  const [r] = await tx`select * from model_source_configs where machine_id=${machineId}`;
  if (!r) return null;
  const ps = await tx`select * from api_providers where machine_id=${machineId} and declared order by id`;
  return {
    revision: Number(r.revision),
    enabled: r.enabled as SourceConfig['enabled'],
    apiProviders: ps.map((p) => ({
      id: String(p.id),
      endpoint: String(p.endpoint),
      protocol: p.protocol as ApiProviderConfig['protocol'],
      models: p.model_ids as ApiProviderConfig['models'],
      localHttp: p.local_http as ApiProviderConfig['localHttp'],
      credentialStatus: p.status as ApiProviderConfig['credentialStatus'],
    })),
  };
}
export async function setSourceConfig(
  tx: Tx,
  machineId: Id,
  input: SourceConfigInput,
  now = new Date(),
): Promise<SourceConfig> {
  if (new Set(input.apiProviders.map((p) => p.id)).size !== input.apiProviders.length)
    fail('PROVIDER_LIST_INVALID', 400);
  for (const p of input.apiProviders) validateApiEndpoint(p);
  const prev = await readSourceConfig(tx, machineId);
  if ((prev?.revision ?? 0) !== input.expectedRevision) fail('CONFIG_REVISION_CONFLICT');
  const clean = (c: SourceConfig) => ({
    enabled: c.enabled,
    apiProviders: c.apiProviders
      .map(({ credentialStatus: _, ...p }) => p)
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
  if (
    prev &&
    same(clean(prev), {
      enabled: input.enabled,
      apiProviders: [...input.apiProviders].sort((a, b) => a.id.localeCompare(b.id)),
    })
  )
    return prev;
  const revision = (prev?.revision ?? 0) + 1;
  await tx`insert into model_source_configs(machine_id,revision,enabled,updated_at) values(${machineId},${revision},${tx.json(json(input.enabled))},${now}) on conflict(machine_id) do update set revision=excluded.revision,enabled=excluded.enabled,updated_at=excluded.updated_at`;
  // A new revision removes old operation write authority without erasing stored secret history.
  await tx`update api_secret_envelopes set state='expired',ciphertext=null,tag=null where machine_id=${machineId} and state='pending'`;
  await tx`update api_providers set current_operation_id=null,status=case when status='pending' then 'missing' else status end,credential_ref=case when status='pending' then null else credential_ref end where machine_id=${machineId}`;
  // Desired removal is reversible while FK-backed historical envelope receipts remain intact.
  await tx`update api_providers set declared=false where machine_id=${machineId}`;
  for (const p of input.apiProviders) {
    const [old] =
      await tx`select endpoint,protocol from api_providers where machine_id=${machineId} and id=${p.id}`;
    if (old && (old.endpoint !== p.endpoint || old.protocol !== p.protocol)) {
      await tx`update api_secret_envelopes set state='expired',ciphertext=null,tag=null where machine_id=${machineId} and provider_id=${p.id} and state='pending'`;
      await tx`update api_providers set status='missing',credential_ref=null where machine_id=${machineId} and id=${p.id}`;
    }
    await tx`insert into api_providers(id,machine_id,endpoint,protocol,model_ids,local_http,status) values(${p.id},${machineId},${p.endpoint},${p.protocol},${tx.json(json(p.models))},${p.localHttp ? tx.json(p.localHttp) : null},'missing') on conflict(machine_id,id) do update set endpoint=excluded.endpoint,protocol=excluded.protocol,model_ids=excluded.model_ids,local_http=excluded.local_http,declared=true`;
  }
  const superseded =
    await tx`update gateway_commands set state='completed',received_at=coalesce(received_at,${now}),completed_at=${now},result=${tx.json({ ok: false, code: 'SUPERSEDED' })} where machine_id=${machineId} and type='sync_models' and state<>'completed' returning id`;
  for (const c of superseded)
    await modelEvent(tx, machineId, 'gateway.command.acknowledged', { commandId: c.id, phase: 'completed' });
  const [cursor] = await tx`update gateway_command_cursor set value=value+1 where singleton returning value`;
  const id = randomUUID();
  await tx`insert into gateway_commands(id,machine_id,type,payload,state,created_at,cursor) values(${id},${machineId},'sync_models',${tx.json({ configRevision: revision })},'queued',${now},${cursor?.value})`;
  await modelEvent(tx, machineId, 'source.desired', { revision });
  await modelEvent(tx, machineId, 'gateway.command.created', { commandId: id, type: 'sync_models' });
  const current = await readSourceConfig(tx, machineId);
  if (!current) fail('CONFIG_NOT_CONFIGURED');
  return current;
}

export async function readModelApplied(tx: Tx, machineId: Id) {
  const [r] = await tx`select * from model_source_applied where machine_id=${machineId}`;
  return r
    ? {
        revision: Number(r.revision),
        reportId: String(r.report_id),
        bootGeneration: String(r.boot_generation),
        sequence: String(r.sequence),
        inventoryReportId: String(r.inventory_report_id),
        reportedAt: (r.reported_at as Date).toISOString(),
        sourceStatus: r.source_status,
      }
    : null;
}
