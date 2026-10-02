import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildApp } from '../../src/app.ts';
import { bootstrapOwner } from '../../src/auth/bootstrap.ts';
import type {
  ConfigInput,
  DispatchSelection,
  GatewayConfig,
  GatewayHeartbeat,
  GatewayProjectionPolicy,
  InstallReport,
  InstallReportResponse,
  ProjectionPin,
  SlotStatus,
  SourcePin,
  WorkflowInventory,
} from '../../src/gateway/contracts.ts';
import { canonicalJson } from '../../src/journal/canonical.ts';
import type { Actor, AuthorizeDispatch, Db, Tx } from '../../src/platform/contracts.ts';
import { ApiError } from '../../src/platform/errors.ts';
import type { HttpIdentity, HttpResponse } from './http.ts';
import { ticketFixture } from './tickets.ts';

export const bootId = randomUUID();
export function source(name: 'bmad' | 'superpowers'): SourcePin {
  const bmad = name === 'bmad';
  return {
    name,
    version: bmad ? '6.12.0' : '6.4.2',
    sourceRevision: bmad
      ? '05bfbd46d00766ec88eb9b42e76be2c575d64d7b'
      : '8ca22dba9a94f28898bbce59f2537ff4d87c747d',
    sourceUrl: bmad
      ? 'https://github.com/bmad-code-org/BMAD-METHOD/archive/refs/tags/v6.12.0.tar.gz'
      : 'https://github.com/obra/superpowers/archive/refs/tags/v6.4.2.tar.gz',
    payloadSha256: (bmad ? 'a' : 'b').repeat(64),
    packageIntegrity: null,
    sourceManifestSha256: 'c'.repeat(64),
    sourceTreeSha256: (bmad ? 'd' : 'e').repeat(64),
  };
}
export function projection(
  name: 'bmad' | 'superpowers',
  runtime: 'claude' | 'codex' | 'api' = 'codex',
): ProjectionPin {
  return {
    runtime,
    sourceTreeSha256: source(name).sourceTreeSha256,
    manifestSha256: 'f'.repeat(64),
    treeSha256: '1'.repeat(64),
    derivation: {
      tool: 'audited-fixture',
      version: '1',
      options: [],
      layoutSchema: '1',
      policySha256: '2'.repeat(64),
    },
  };
}
export const nextConfig: ConfigInput = {
  expectedRevision: 0,
  enabled: true,
  maxJobs: 2,
  desired: {
    bmad: { source: source('bmad'), projections: { claude: null, codex: projection('bmad'), api: null } },
    superpowers: {
      source: source('superpowers'),
      projections: { claude: null, codex: projection('superpowers'), api: null },
    },
  },
};
export function inventory(current = false): WorkflowInventory {
  const slot = <T>(installed: T | null): SlotStatus<T> => ({
    state: installed === null ? 'missing' : 'current',
    installed,
    lastError: null,
    observedAt: installed ? '2026-10-01T00:00:00.000Z' : null,
  });
  const workflow = (name: 'bmad' | 'superpowers') => ({
    source: slot(current ? source(name) : null),
    projections: {
      claude: slot<ProjectionPin>(null),
      codex: slot(current ? projection(name) : null),
      api: slot<ProjectionPin>(null),
    },
  });
  return { bmad: workflow('bmad'), superpowers: workflow('superpowers') };
}
export function heartbeat(
  id: string,
  generation: string,
  sequence: string,
  changes: Record<string, unknown> = {},
): GatewayHeartbeat {
  return {
    bootId: id,
    bootGeneration: generation,
    sequence,
    observedAt: '2000-01-01T00:00:00.000Z',
    hostVersion: '1',
    appVersion: null,
    telemetry: {
      cpuLoad1: 1,
      cpuCount: 8,
      memoryAvailableBytes: '1000000',
      memoryPressure: 'normal',
      diskAvailableBytes: '2000000',
      activeJobs: 0,
      configuredMaxJobs: 2,
    },
    inventory: inventory(),
    processes: [],
    ...changes,
  };
}
export const report = (id: string, generation: string, revision = 1, current = true): InstallReport => ({
  reportId: randomUUID(),
  bootId: id,
  bootGeneration: generation,
  configRevision: revision,
  reportedAt: '2000-01-01T00:00:00.000Z',
  results: inventory(current),
});
export async function countExecutionRows(db: Db) {
  const [row] =
    await db`select (select count(*)::int from commands) as commands,(select count(*)::int from attempts) as attempts,(select count(*)::int from execution_guards) as guards`;
  return row;
}
export async function gatewayFixture(
  db: Db,
  config: {
    projectionPolicy?: GatewayProjectionPolicy;
    authorizeDispatch?: AuthorizeDispatch;
    prior?: { identity: HttpIdentity; machineId: string; token: string };
    now?: () => Date;
  } = {},
) {
  const identity = config.prior?.identity ?? {
    password: randomBytes(24).toString('hex'),
    cookie: '',
    csrf: '',
    key: randomBytes(32),
  };
  if (!config.prior) await bootstrapOwner(db, identity.password);
  const app = await buildApp({
    db,
    publicOrigin: 'http://localhost:5182',
    secureCookies: false,
    sessionEncryptionKey: identity.key,
    now: config.now ?? (() => new Date()),
    gatewayProjectionPolicy: config.projectionPolicy,
    authorizeDispatch: config.authorizeDispatch,
  });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<HttpResponse> {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return {
      statusCode: response.status,
      headers: response.headers,
      text,
      json: <T>() => JSON.parse(text) as T,
    };
  }
  if (!config.prior) {
    const login = await request(
      '/v2/auth/session',
      'POST',
      { password: identity.password },
      { origin: 'http://localhost:5182' },
    );
    assert.equal(login.statusCode, 200, login.text);
    identity.cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    identity.csrf = login.json<{ csrfToken: string }>().csrfToken;
  }
  const ownerWrite = (path: string, method: string, body: unknown, key: string = randomUUID()) =>
    request(path, method, body, {
      cookie: identity.cookie,
      origin: 'http://localhost:5182',
      'x-csrf-token': identity.csrf,
      'idempotency-key': key,
    });
  const machineWrite = (path: string, token: string, body: unknown, key: string = randomUUID()) =>
    request(path, 'POST', body, { authorization: `Bearer ${token}`, 'idempotency-key': key });
  let machineId: string, token: string;
  if (config.prior) {
    machineId = config.prior.machineId;
    token = config.prior.token;
  } else {
    const response = await ownerWrite('/v2/machines', 'POST', { name: 'gateway-test' });
    assert.equal(response.statusCode, 201, response.text);
    const provisioned = response.json<{ machine: { id: string }; token: string }>();
    machineId = provisioned.machine.id;
    token = provisioned.token;
  }
  return {
    app,
    url,
    identity,
    request,
    machineId,
    token,
    prior: { identity, machineId, token },
    machineWrite,
    owner: {
      put: (path: string, body: unknown, key?: string) => ownerWrite(path, 'PUT', body, key),
      post: (path: string, body: unknown, key?: string) => ownerWrite(path, 'POST', body, key),
      get: (path: string) => request(path, 'GET', undefined, { cookie: identity.cookie }),
    },
    machine: {
      post: (path: string, body: unknown, key?: string) => machineWrite(path, token, body, key),
      get: (path: string) => request(path, 'GET', undefined, { authorization: `Bearer ${token}` }),
    },
    close: () => app.close(),
  };
}

/** Private DB-backed authority, never exported or wired by production app. */
export async function selectionAuthorityFixture(db: Db) {
  await db`create table gateway_test_claim_authorizations(command_id uuid primary key references commands(id),selection jsonb not null)`;
  function reject(): never {
    throw new ApiError('SELECTION_MISMATCH', 409, 'Selection fixture không khớp');
  }
  async function selection(tx: Tx, commandId: string, actor: Actor): Promise<DispatchSelection> {
    const [c] =
      await tx`select c.*,d.kind as decision_kind,d.ticket_id as decision_ticket,d.scope from commands c left join decisions d on d.id=(c.payload->'selection'->>'decisionId')::uuid where c.id=${commandId}`;
    if (
      !c ||
      actor.kind !== 'machine' ||
      c.machine_id !== actor.id ||
      c.decision_kind !== 'dispatch' ||
      c.decision_ticket !== c.ticket_id
    )
      reject();
    const selected = (c.payload as { selection?: DispatchSelection }).selection;
    const decisionSelection = (c.scope as { selection?: DispatchSelection }).selection;
    if (!selected || !decisionSelection || canonicalJson(selected) !== canonicalJson(decisionSelection))
      reject();
    return selected;
  }
  const authorizeDispatch: AuthorizeDispatch = async (tx, actor, permit) => {
    const selected = await selection(tx, permit.commandId, actor);
    if (selected.decisionId !== permit.decisionId) reject();
    const [row] = await tx`select * from gateway_configs where machine_id=${actor.id}`;
    const config = row
      ? ({
          revision: Number(row.revision),
          desired: row.desired,
          maxJobs: Number(row.max_jobs),
          enabled: row.enabled,
        } as GatewayConfig)
      : null;
    const [applied] = await tx`select * from gateway_applied where machine_id=${actor.id}`;
    const [latest] =
      await tx`select * from gateway_install_reports where machine_id=${actor.id} and id=${applied?.latest_report_id}`;
    if (
      !config?.enabled ||
      config.revision !== selected.configRevision ||
      Number(applied?.revision) !== config.revision ||
      latest?.id !== selected.installReportId ||
      !(latest.response as InstallReportResponse).accepted
    )
      reject();
    const desired = config.desired[permit.workflow.workflow];
    const projection = desired.projections[selected.runtime];
    if (
      !projection ||
      selected.sourceTreeSha256 !== desired.source.sourceTreeSha256 ||
      permit.workflow.version !== desired.source.version ||
      permit.workflow.revision !== desired.source.sourceRevision ||
      permit.workflow.checksum !== desired.source.sourceTreeSha256 ||
      selected.projectionManifestSha256 !== projection.manifestSha256 ||
      selected.projectionTreeSha256 !== projection.treeSha256
    )
      reject();
    await tx`insert into gateway_test_claim_authorizations(command_id,selection) values(${permit.commandId},${tx.json(JSON.parse(canonicalJson(selected)))})`;
  };
  const projectionPolicy: GatewayProjectionPolicy = {
    authorize: async (tx, { attemptId, actor }) => {
      const [attempt] = await tx`select * from attempts where id=${attemptId}`;
      if (!attempt || attempt.machine_id !== actor.id) reject();
      const selected = await selection(tx, String(attempt.command_id), actor);
      const [proof] =
        await tx`select selection from gateway_test_claim_authorizations where command_id=${attempt.command_id}`;
      if (!proof || canonicalJson(proof.selection) !== canonicalJson(selected)) reject();
      return selected;
    },
  };
  return { authorizeDispatch, projectionPolicy };
}

export async function prepareSelection(
  f: Awaited<ReturnType<typeof gatewayFixture>>,
  db: Db,
  changes: Partial<DispatchSelection> = {},
) {
  const tickets = await ticketFixture(db);
  await db`update projects set machine_id=${f.machineId},checkout_path='/tmp/gateway-fixture',binding_revision=2 where id=${tickets.project.id}`;
  const workflow = {
    workflow: 'superpowers' as const,
    version: '6.4.2',
    revision: '8ca22dba9a94f28898bbce59f2537ff4d87c747d',
    checksum: 'e'.repeat(64),
  };
  await db`update tickets set status='ready',workflow_pin=${db.json(workflow)} where id=${tickets.a.id}`;
  const [r] = await db`select latest_report_id as id from gateway_applied where machine_id=${f.machineId}`;
  const decisionId = randomUUID();
  const selected: DispatchSelection = {
    runtime: 'codex',
    sourceTreeSha256: 'e'.repeat(64),
    projectionManifestSha256: 'f'.repeat(64),
    projectionTreeSha256: '1'.repeat(64),
    installReportId: String(r?.id),
    configRevision: 1,
    decisionId,
    ...changes,
  };
  await db`insert into decisions(id,ticket_id,actor_kind,actor_id,kind,content,rationale,sources,scope) values(${decisionId},${tickets.a.id},'owner','owner','dispatch','Test authority','Test authority','[]',${db.json({ selection: selected })})`;
  const response = await f.owner.post('/v2/commands', {
    machineId: f.machineId,
    ticketId: tickets.a.id,
    type: 'start',
    payload: { selection: selected },
  });
  assert.equal(response.statusCode, 202, response.text);
  const commandId = response.json<{ id: string }>().id;
  const now = Date.now();
  const permit = {
    commandId,
    ticketId: tickets.a.id,
    machineId: f.machineId,
    bindingRevision: 2,
    ticketRevision: 1,
    workflow,
    checkedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 20000).toISOString(),
    telemetryId: randomUUID(),
    decisionId,
  };
  const processInstanceId = randomUUID();
  return {
    selected,
    commandId,
    decisionId,
    tickets,
    claim: () => f.machine.post(`/v2/machine/commands/${commandId}/claim`, { processInstanceId, permit }),
    processInstanceId,
  };
}
