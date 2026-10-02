import { randomUUID } from 'node:crypto';
import type {
  DispatchSelection,
  InstallReportResponse,
  ProjectionPin,
  SourcePin,
} from '../gateway/contracts.ts';
import { toDomainPin } from '../gateway/contracts.ts';
import { readGatewayConfig } from '../gateway/service.ts';
import { parseCursor } from '../journal/events.ts';
import type { Db, DispatchPermit, Id, Tx } from '../platform/contracts.ts';
import { readSourceConfig } from './config.ts';
import type {
  ModelAppliedBody,
  ModelDispatchChoice,
  ModelInventoryBody,
  ModelProofVerifier,
  ModelReportEnvelope,
  PoolEntry,
  ProbeContext,
  ProbeResult,
} from './contracts.ts';
import { sources } from './contracts.ts';
import { contextHash, fail, hash, json, modelEvent, receiptExpiry, same } from './helpers.ts';
export const denyModelProof: ModelProofVerifier = {
  verify: async () => ({ status: 'unverified', capabilities: [] }),
};
export async function latestInventory(tx: Tx, machineId: Id) {
  const [r] =
    await tx`select r.* from model_report_receipts r join gateway_boots b on b.machine_id=r.machine_id and b.boot_generation=r.boot_generation and b.retired_at is null join model_source_configs c on c.machine_id=r.machine_id and c.revision=r.config_revision where r.machine_id=${machineId} and r.kind='inventory' order by r.sequence desc limit 1`;
  return r;
}
async function prepareReport(tx: Tx, machineId: Id, r: ModelReportEnvelope<unknown>, kind: string) {
  parseCursor(r.bootGeneration);
  parseCursor(r.sequence);
  if (r.sequence === '0' || r.bootGeneration === '0') fail('REPORT_SEQUENCE_CONFLICT');
  const bodyHash = hash({ kind, ...r });
  const [old] = await tx`select * from model_report_receipts where id=${r.reportId}`;
  if (old) {
    if (old.machine_id !== machineId) fail('NOT_FOUND', 404);
    if (old.body_hash !== bodyHash) fail('REPORT_ID_CONFLICT');
    return { cached: old.response, bodyHash };
  }
  const [boot] =
    await tx`select 1 from gateway_boots where machine_id=${machineId} and boot_id=${r.bootId} and boot_generation=${r.bootGeneration} and retired_at is null`;
  if (!boot) fail('BOOT_RETIRED');
  const config = await readSourceConfig(tx, machineId);
  if (!config || config.revision !== r.configRevision) fail('CONFIG_REVISION_CONFLICT');
  const [last] =
    await tx`select max(sequence) as sequence from model_report_receipts where machine_id=${machineId} and boot_generation=${r.bootGeneration}`;
  if (
    last?.sequence !== null &&
    last?.sequence !== undefined &&
    BigInt(r.sequence) <= BigInt(String(last.sequence))
  )
    fail('REPORT_SEQUENCE_CONFLICT');
  return { cached: undefined, bodyHash, config };
}
async function record(
  tx: Tx,
  machineId: Id,
  r: ModelReportEnvelope<unknown>,
  kind: string,
  bodyHash: string,
  response: unknown,
  now: Date,
) {
  await tx`insert into model_report_receipts(id,machine_id,boot_id,boot_generation,sequence,kind,config_revision,body_hash,body,response,received_at) values(${r.reportId},${machineId},${r.bootId},${r.bootGeneration},${r.sequence},${kind},${r.configRevision},${bodyHash},${tx.json(json(r.body))},${tx.json(json(response))},${now})`;
  return response;
}
export async function reportModelInventory(
  tx: Tx,
  machineId: Id,
  r: ModelReportEnvelope<ModelInventoryBody>,
  now = new Date(),
  verifier: ModelProofVerifier = denyModelProof,
) {
  const check = await prepareReport(tx, machineId, r, 'inventory');
  if (check.cached !== undefined) return check.cached;
  const keys = new Set<string>();
  for (const p of r.body.entries) {
    const key = hash({ key: p.key, sourceTreeSha256: p.context.sourceTreeSha256 });
    if (p.key.machineId !== machineId || keys.has(key) || !check.config?.enabled[p.key.runtime])
      fail('MODEL_SCOPE_MISMATCH');
    keys.add(key);
    if (p.key.runtime === 'api') {
      const provider = check.config?.apiProviders.find((a) => a.id === p.key.providerId);
      if (!provider?.models.some((m) => m.id === p.key.modelId)) fail('MODEL_NOT_DECLARED');
    }
    if (p.key.runtime !== 'api' && p.key.providerId !== p.key.runtime) fail('MODEL_SCOPE_MISMATCH');
    const proof =
      p.status === 'fail' ? { status: 'fail' as const, capabilities: [] } : await verifier.verify(tx, p);
    const status = proof.status;
    const caps = status === 'pass' ? proof.capabilities.filter((c) => p.capabilities.includes(c)) : [];
    await tx`insert into model_probe_receipts(id,machine_id,runtime,provider_id,model_id,config_revision,inventory_report_id,context,context_sha256,boot_generation,sequence,observed_at,received_at,expires_at,status,capabilities,evidence_digest,error_code,runtime_version) values(${randomUUID()},${machineId},${p.key.runtime},${p.key.providerId},${p.key.modelId},${r.configRevision},${r.reportId},${tx.json(json(p.context))},${contextHash(p.context)},${r.bootGeneration},${r.sequence},${p.observedAt},${now},${receiptExpiry(now)},${status},${tx.json(caps)},${p.evidenceDigest},${p.errorCode},${p.runtimeVersion})`;
  }
  return record(
    tx,
    machineId,
    r,
    'inventory',
    check.bodyHash,
    { reportId: r.reportId, accepted: true, serverTime: now.toISOString(), observationDigest: hash(r.body) },
    now,
  );
}
export async function reportModelApplied(
  tx: Tx,
  machineId: Id,
  r: ModelReportEnvelope<ModelAppliedBody>,
  now = new Date(),
) {
  const check = await prepareReport(tx, machineId, r, 'applied');
  if (check.cached !== undefined) return check.cached;
  const inventory = await latestInventory(tx, machineId);
  if (
    !inventory ||
    inventory.id !== r.body.inventoryReportId ||
    String(inventory.boot_generation) !== r.bootGeneration ||
    hash(inventory.body) !== r.body.observationDigest
  )
    fail('INVENTORY_SUPERSEDED');
  const complete = sources.every((s) => r.body.sourceStatus[s] !== undefined);
  if (complete) {
    for (const s of sources) {
      const status = r.body.sourceStatus[s];
      if (!check.config?.enabled[s] !== (status.state === 'disabled')) fail('SOURCE_STATUS_MISMATCH');
      const entries = (inventory.body as ModelInventoryBody).entries.filter((p) => p.key.runtime === s);
      if (status.state === 'ready' && (!entries.length || entries.some((p) => p.status === 'fail')))
        fail('SOURCE_STATUS_MISMATCH');
    }
    await tx`insert into model_source_applied(machine_id,revision,report_id,boot_generation,sequence,inventory_report_id,reported_at,source_status) values(${machineId},${r.configRevision},${r.reportId},${r.bootGeneration},${r.sequence},${r.body.inventoryReportId},${now},${tx.json(json(r.body.sourceStatus))}) on conflict(machine_id) do update set revision=excluded.revision,report_id=excluded.report_id,boot_generation=excluded.boot_generation,sequence=excluded.sequence,inventory_report_id=excluded.inventory_report_id,reported_at=excluded.reported_at,source_status=excluded.source_status`;
    await modelEvent(tx, machineId, 'source.applied', { revision: r.configRevision, reportId: r.reportId });
  }
  return record(
    tx,
    machineId,
    r,
    'applied',
    check.bodyHash,
    { reportId: r.reportId, accepted: true, applied: complete, serverTime: now.toISOString() },
    now,
  );
}
export const modelKeyId = (key: ProbeResult['key']) =>
  `model:v1:${[key.machineId, key.runtime, key.providerId, key.modelId].map(encodeURIComponent).join(':')}`;
async function currentPair(tx: Tx, machineId: Id, source: SourcePin, runtime: ProbeResult['key']['runtime']) {
  const config = await readGatewayConfig(tx, machineId);
  const desired = config?.desired[source.name];
  const [applied] = await tx`select * from gateway_applied where machine_id=${machineId}`;
  const [report] =
    await tx`select r.* from gateway_install_reports r join gateway_boots b on b.machine_id=r.machine_id and b.boot_generation=r.boot_generation and b.retired_at is null where r.id=${applied?.latest_report_id ?? null} and r.machine_id=${machineId}`;
  const response = report?.response as InstallReportResponse | undefined;
  const proj = desired?.projections[runtime] ?? null;
  const okay =
    !!config?.enabled &&
    same(desired?.source, source) &&
    Number(applied?.revision) === config.revision &&
    Number(report?.config_revision) === config.revision &&
    response?.accepted === true &&
    proj !== null &&
    same(response.workflows[source.name].source.installed, source) &&
    same(response.workflows[source.name].projections[runtime].installed, proj);
  return { okay, projection: proj, reportId: report?.id as Id | undefined, config };
}
function matchesContext(c: ProbeContext, source: SourcePin, p: ProjectionPin) {
  return (
    c.sourceTreeSha256 === source.sourceTreeSha256 &&
    c.projectionManifestSha256 === p.manifestSha256 &&
    c.projectionTreeSha256 === p.treeSha256 &&
    c.derivationSha256 === hash(p.derivation)
  );
}
export async function getPool(
  db: Db | Tx,
  machineId: Id,
  source: SourcePin,
  now = new Date(),
): Promise<PoolEntry[]> {
  const tx = db as Tx,
    config = await readSourceConfig(tx, machineId);
  if (!config) return [];
  const inventory = await latestInventory(tx, machineId);
  const probes = inventory
    ? await tx`select * from model_probe_receipts where inventory_report_id=${inventory.id}`
    : [];
  const [applied] = await tx`select * from model_source_applied where machine_id=${machineId}`;
  const keys = probes
    .filter(
      (p, index) =>
        probes.findIndex(
          (q) => q.runtime === p.runtime && q.provider_id === p.provider_id && q.model_id === p.model_id,
        ) === index,
    )
    .map((p) => ({
      machineId,
      runtime: p.runtime as ProbeResult['key']['runtime'],
      providerId: String(p.provider_id),
      modelId: String(p.model_id),
    }));
  for (const provider of config.apiProviders)
    for (const model of provider.models)
      if (!keys.some((k) => k.runtime === 'api' && k.providerId === provider.id && k.modelId === model.id))
        keys.push({ machineId, runtime: 'api', providerId: provider.id, modelId: model.id });
  const entries: PoolEntry[] = [];
  for (const key of keys) {
    const row = probes.find(
      (p) =>
        p.runtime === key.runtime &&
        p.provider_id === key.providerId &&
        p.model_id === key.modelId &&
        (p.context as ProbeContext).sourceTreeSha256 === source.sourceTreeSha256,
    );
    const pair = await currentPair(tx, machineId, source, key.runtime);
    const context = row?.context as ProbeContext | undefined;
    const sourceApplied =
      Number(applied?.revision) === config.revision &&
      applied?.inventory_report_id === inventory?.id &&
      String(applied?.boot_generation) === String(inventory?.boot_generation);
    const sourceStatus = (applied?.source_status as ModelAppliedBody['sourceStatus'] | undefined)?.[
      key.runtime
    ];
    const provider = config.apiProviders.find((p) => p.id === key.providerId);
    const [cert] = context
      ? await tx`select * from runtime_certification_receipts where machine_id=${machineId} and runtime=${key.runtime} and source_tree_sha256=${context.sourceTreeSha256} and projection_manifest_sha256=${context.projectionManifestSha256} and projection_tree_sha256=${context.projectionTreeSha256} and derivation_hash=${context.derivationSha256} and binary_hash=${context.binarySha256} and policy_hash=${context.policySha256} and os_version=${context.osVersion} order by received_at desc limit 1`
      : [];
    let reason: string | null = null;
    if (!config.enabled[key.runtime]) reason = 'SOURCE_DISABLED';
    else if (!sourceApplied) reason = 'MODEL_CONFIG_PENDING';
    else if (sourceStatus?.state !== 'ready') reason = sourceStatus?.errorCode ?? 'SOURCE_UNAVAILABLE';
    else if (key.runtime === 'api' && provider?.credentialStatus !== 'stored')
      reason = provider?.credentialStatus === 'pending' ? 'CREDENTIAL_PENDING' : 'CREDENTIAL_MISSING';
    else if (!pair.okay || !pair.projection) reason = 'WORKFLOW_UNAVAILABLE';
    else if (!row || !context) reason = 'UNPROBED';
    else if (!matchesContext(context, source, pair.projection)) reason = 'PROBE_CONTEXT_CHANGED';
    else if (row.status !== 'pass') reason = String(row.error_code ?? 'UNVERIFIED');
    else if ((row.expires_at as Date).getTime() <= now.getTime()) reason = 'PROBE_EXPIRED';
    else if (cert?.status !== 'PASS' || (cert.expires_at as Date).getTime() <= now.getTime())
      reason = 'CERTIFICATION_UNVERIFIED';
    const probe = row
      ? {
          key,
          context: row.context as ProbeContext,
          observedAt: (row.observed_at as Date).toISOString(),
          status: row.status as ProbeResult['status'],
          capabilities: row.capabilities as ProbeResult['capabilities'],
          evidenceDigest: String(row.evidence_digest),
          errorCode: row.error_code as string | null,
          runtimeVersion: row.runtime_version as string | null,
        }
      : null;
    entries.push({
      ...key,
      source,
      projection: pair.projection,
      installReportId: pair.reportId ?? null,
      declared:
        config.apiProviders.find((p) => p.id === key.providerId)?.models.find((m) => m.id === key.modelId)
          ?.declared ??
        probe?.capabilities ??
        [],
      probe,
      probeReceiptId: row ? String(row.id) : null,
      probeContextSha256: row ? String(row.context_sha256) : null,
      probeReceivedAt: row ? (row.received_at as Date).toISOString() : null,
      probeExpiresAt: row ? (row.expires_at as Date).toISOString() : null,
      sourceDesired: config.enabled[key.runtime],
      sourceApplied,
      available: reason === null,
      reason,
    });
  }
  return entries;
}
export async function assertModelDispatch(
  tx: Tx,
  permit: DispatchPermit,
  choice: ModelDispatchChoice,
  now = new Date(),
): Promise<void> {
  const [machine] = await tx`select revoked_at from machines where id=${permit.machineId} for update`;
  if (!machine || machine.revoked_at) fail('NOT_FOUND', 404);
  const config = await readSourceConfig(tx, permit.machineId);
  if (!config?.enabled[choice.model.runtime]) fail('SOURCE_DISABLED');
  if (config.revision !== choice.modelConfigRevision || choice.model.machineId !== permit.machineId)
    fail('MODEL_CHOICE_STALE');
  const [command] = await tx`select * from commands where id=${permit.commandId}`;
  const [decision] = await tx`select * from decisions where id=${permit.decisionId}`;
  const payload = command?.payload as
      | { selection?: DispatchSelection; modelChoice?: ModelDispatchChoice }
      | undefined,
    scope = decision?.scope as typeof payload;
  if (
    command?.machine_id !== permit.machineId ||
    command?.ticket_id !== permit.ticketId ||
    decision?.kind !== 'dispatch' ||
    decision?.ticket_id !== permit.ticketId ||
    !same(payload?.modelChoice, choice) ||
    !same(scope?.modelChoice, choice) ||
    !payload?.selection ||
    !same(payload.selection, scope?.selection) ||
    payload.selection.decisionId !== permit.decisionId ||
    payload.selection.runtime !== choice.model.runtime
  )
    fail('MODEL_SELECTION_MISMATCH');
  const workflow = await readGatewayConfig(tx, permit.machineId),
    source = workflow?.desired[permit.workflow.workflow].source;
  if (!source || !same(toDomainPin(source), permit.workflow)) fail('WORKFLOW_UNAVAILABLE');
  const pool = await getPool(tx, permit.machineId, source, now);
  const entry = pool.find((p) =>
    same(
      { machineId: p.machineId, runtime: p.runtime, providerId: p.providerId, modelId: p.modelId },
      choice.model,
    ),
  );
  if (
    !entry?.available ||
    entry.probeReceiptId !== choice.probeReceiptId ||
    entry.probeContextSha256 !== choice.probeContextSha256 ||
    !entry.probe ||
    !choice.required.every((c) => entry.probe?.capabilities.includes(c)) ||
    entry.installReportId !== payload.selection.installReportId ||
    workflow?.revision !== payload.selection.configRevision ||
    entry.projection?.manifestSha256 !== payload.selection.projectionManifestSha256 ||
    entry.projection?.treeSha256 !== payload.selection.projectionTreeSha256
  )
    fail('MODEL_UNAVAILABLE');
  const [cert] =
    await tx`select * from runtime_certification_receipts where id=${choice.certificationReceiptId}`;
  const c = entry.probe.context;
  if (
    !cert ||
    cert.machine_id !== permit.machineId ||
    cert.runtime !== choice.model.runtime ||
    cert.status !== 'PASS' ||
    (cert.expires_at as Date).getTime() <= now.getTime() ||
    cert.source_tree_sha256 !== c.sourceTreeSha256 ||
    cert.projection_manifest_sha256 !== c.projectionManifestSha256 ||
    cert.projection_tree_sha256 !== c.projectionTreeSha256 ||
    cert.derivation_hash !== c.derivationSha256 ||
    cert.binary_hash !== c.binarySha256 ||
    cert.policy_hash !== c.policySha256 ||
    cert.os_version !== c.osVersion
  )
    fail('CERTIFICATION_UNVERIFIED');
}
