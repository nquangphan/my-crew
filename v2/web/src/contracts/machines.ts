import { arr, bool, type Infer, int, lit, nul, nullable, obj, oneOf, page, str, uuid } from './http.ts';

/** `Machine`, `v2/server/src/auth/machine.ts:7`; GET `/v2/machines/:id`, page at `auth/routes.ts:179`. */
export const decodeMachine = obj({ id: uuid, name: str, revokedAt: nullable(str) });
export type Machine = Infer<typeof decodeMachine>;
export const decodeMachinePage = page(decodeMachine);

/**
 * POST `/v2/machines` result (`provisionMachine`, `auth/machine.ts:9`). The token is a credential: callers keep
 * it in component memory only, never in the query cache, logger or storage.
 */
export const decodeProvisionedMachine = obj({ machine: decodeMachine, token: str });
export type ProvisionedMachine = Infer<typeof decodeProvisionedMachine>;

/** `Project`, `v2/server/src/projects/service.ts:13`; list/page at `projects/routes.ts:45`. */
export const decodeProject = obj({
  id: uuid,
  key: str,
  name: str,
  repositoryUrl: nullable(str),
  machineId: nullable(uuid),
  checkoutPath: nullable(str),
  bindingRevision: int,
  docsState: lit('missing', 'unverified', 'invalid', 'current', 'stale'),
});
export type Project = Infer<typeof decodeProject>;
export const decodeProjectPage = page(decodeProject);
export type CreateProject = { key: string; name: string; repositoryUrl: string | null };

const runtime = lit('claude', 'codex', 'api');
const capability = lit('tools', 'vision', 'text', 'stream', 'file_pdf', 'file_docx', 'file_xlsx', 'file_csv');

/** `ApiProviderConfig`, `v2/server/src/models/contracts.ts:77` (read via `models/config.ts:36`). */
export const decodeApiProvider = obj({
  id: str,
  endpoint: str,
  protocol: lit('responses', 'chat-completions'),
  models: arr(obj({ id: str, declared: arr(capability) })),
  credentialStatus: lit('missing', 'pending', 'stored'),
  localHttp: nullable(obj({ enabled: lit(true), allowedOrigin: str })),
});
export type ApiProvider = Infer<typeof decodeApiProvider>;

const sourceState = obj({ state: lit('disabled', 'ready', 'error'), errorCode: nullable(str) });

/** Applied receipt `readModelApplied`, `v2/server/src/models/config.ts:108`. */
export const decodeModelApplied = obj({
  revision: int,
  reportId: uuid,
  bootGeneration: str,
  sequence: str,
  inventoryReportId: uuid,
  reportedAt: str,
  sourceStatus: obj({ claude: sourceState, codex: sourceState, api: sourceState }),
});
export type ModelApplied = Infer<typeof decodeModelApplied>;

const enabled = obj({ claude: bool, codex: bool, api: bool });

/** GET `/v2/machines/:id/model-sources`, `v2/server/src/models/routes.ts:211`. Desired and applied stay distinct. */
export const decodeModelSourcesView = oneOf<
  | {
      revision: number;
      enabled: Infer<typeof enabled>;
      apiProviders: ApiProvider[];
      applied: ModelApplied | null;
    }
  | { desiredConfig: null; applied: ModelApplied | null }
>(
  obj({
    revision: int,
    enabled,
    apiProviders: arr(decodeApiProvider),
    applied: nullable(decodeModelApplied),
  }),
  obj({ desiredConfig: nul, applied: nullable(decodeModelApplied) }),
);
export type ModelSourcesView = Infer<typeof decodeModelSourcesView>;

/** `SourcePin`/`ProjectionPin`, `v2/server/src/gateway/contracts.ts:6,16`. */
export const decodeSourcePin = obj({
  name: lit('bmad', 'superpowers'),
  version: str,
  sourceRevision: str,
  sourceUrl: str,
  payloadSha256: str,
  packageIntegrity: nullable(str),
  sourceManifestSha256: str,
  sourceTreeSha256: str,
});
export const decodeProjectionPin = obj({
  runtime,
  sourceTreeSha256: str,
  manifestSha256: str,
  treeSha256: str,
  derivation: obj({ tool: str, version: str, options: arr(str), layoutSchema: str, policySha256: str }),
});

const modelKey = { machineId: uuid, runtime, providerId: str, modelId: str };

/** `ProbeResult`, `v2/server/src/models/contracts.ts:30`. */
export const decodeProbeResult = obj({
  key: obj(modelKey),
  context: obj({
    sourceTreeSha256: str,
    projectionManifestSha256: str,
    projectionTreeSha256: str,
    derivationSha256: str,
    binarySha256: str,
    policySha256: str,
    osVersion: str,
  }),
  observedAt: str,
  status: lit('pass', 'fail', 'unverified'),
  capabilities: arr(capability),
  evidenceDigest: str,
  errorCode: nullable(str),
  runtimeVersion: nullable(str),
});

/** `PoolEntry`, `v2/server/src/models/contracts.ts:40`; GET `/v2/machines/:id/models` at `models/routes.ts:275`. */
export const decodePoolEntry = obj({
  ...modelKey,
  source: decodeSourcePin,
  projection: nullable(decodeProjectionPin),
  installReportId: nullable(uuid),
  declared: arr(capability),
  probe: nullable(decodeProbeResult),
  probeReceiptId: nullable(uuid),
  probeContextSha256: nullable(str),
  probeReceivedAt: nullable(str),
  probeExpiresAt: nullable(str),
  sourceDesired: bool,
  sourceApplied: bool,
  available: bool,
  reason: nullable(str),
});
export type PoolEntry = Infer<typeof decodePoolEntry>;
export const decodeModelPool = obj({ items: arr(decodePoolEntry), reason: nullable(str) });
