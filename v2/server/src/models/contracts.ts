import type {
  DispatchSelection,
  GatewayCommand,
  ProjectionPin,
  Runtime,
  SourcePin,
} from '../gateway/contracts.ts';
import { counterSchema, digestSchema, objectSchema, uuidSchema } from '../gateway/contracts.ts';
import type { Id, Tx } from '../platform/contracts.ts';
export type Source = Runtime;
export type Capability =
  | 'tools'
  | 'vision'
  | 'text'
  | 'stream'
  | 'file_pdf'
  | 'file_docx'
  | 'file_xlsx'
  | 'file_csv';
export type ModelKey = { machineId: Id; runtime: Source; providerId: string; modelId: string };
export type ProbeContext = {
  sourceTreeSha256: string;
  projectionManifestSha256: string;
  projectionTreeSha256: string;
  derivationSha256: string;
  binarySha256: string;
  policySha256: string;
  osVersion: string;
};
export type ProbeResult = {
  key: ModelKey;
  context: ProbeContext;
  observedAt: string;
  status: 'pass' | 'fail' | 'unverified';
  capabilities: Capability[];
  evidenceDigest: string;
  errorCode: string | null;
  runtimeVersion: string | null;
};
export type PoolEntry = ModelKey & {
  source: SourcePin;
  projection: ProjectionPin | null;
  installReportId: Id | null;
  declared: Capability[];
  probe: ProbeResult | null;
  probeReceiptId: Id | null;
  probeContextSha256: string | null;
  probeReceivedAt: string | null;
  probeExpiresAt: string | null;
  sourceDesired: boolean;
  sourceApplied: boolean;
  available: boolean;
  reason: string | null;
};
export type ModelDispatchChoice = {
  model: ModelKey;
  modelConfigRevision: number;
  probeReceiptId: Id;
  probeContextSha256: string;
  certificationReceiptId: Id | null;
  required: Capability[];
};
export type ModelReportEnvelope<T> = {
  reportId: Id;
  bootId: Id;
  bootGeneration: string;
  sequence: string;
  configRevision: number;
  body: T;
};
export type ModelInventoryBody = { entries: ProbeResult[] };
export type ModelAppliedBody = {
  inventoryReportId: Id;
  sourceStatus: Record<Source, { state: 'disabled' | 'ready' | 'error'; errorCode: string | null }>;
  observationDigest: string;
};
export type ApiProviderConfig = {
  id: string;
  endpoint: string;
  protocol: 'responses' | 'chat-completions';
  models: { id: string; declared: Capability[] }[];
  credentialStatus: 'missing' | 'pending' | 'stored';
  localHttp: { enabled: true; allowedOrigin: string } | null;
};
export type ApiCredentialBindings = {
  machineId: string;
  configRevision: number | null;
  apiEnabled: boolean;
  providers: {
    providerId: string;
    endpoint: string;
    protocol: ApiProviderConfig['protocol'];
    status: ApiProviderConfig['credentialStatus'];
    credentialRef: string | null;
    currentOperationId: string | null;
  }[];
};
export type SourceConfig = {
  revision: number;
  enabled: Record<Source, boolean>;
  apiProviders: ApiProviderConfig[];
};
export type SourceConfigInput = {
  expectedRevision: number;
  enabled: Record<Source, boolean>;
  apiProviders: Omit<ApiProviderConfig, 'credentialStatus'>[];
};
export type CertificationChallenge = {
  id: Id;
  nonce: string;
  machineId: Id;
  projectId: Id;
  expiresAt: string;
  maxTurns: number;
  maxTools: number;
  maxCostUsd: number;
} & ProbeContext;
export type CertificationEvidence = {
  challengeId: Id;
  attemptId: Id;
  fence: string;
  processInstanceId: Id;
  context: ProbeContext;
  surfaceResults: {
    surface: string;
    selectedWorked: boolean;
    unselectedDenied: boolean;
    traceSha256: string;
  }[];
  artifactIds: Id[];
  traceSha256: string;
};
export type RuntimeAdmission =
  | { kind: 'certified'; receiptId: Id }
  | { kind: 'test-certification'; challengeId: Id; nonce: string };
export type CredentialKeyRegistration = { keyId: Id; publicKeyX25519: string };
export type CredentialKeyConfirmation = { challengeId: Id; challengeSha256: string };
export type SecretEnvelope = {
  id: Id;
  machineId: Id;
  providerId: Id;
  keyId: Id;
  configRevision: number;
  operationId: Id;
  expiresAt: string;
  ephemeralPublicKey: string;
  nonce: string;
  ciphertext: string;
  tag: string;
  ciphertextSha256: string;
};
export type SecretAck = { operationId: Id; keyId: Id; ciphertextSha256: string; credentialRef: string };
export type SecretInput = { expectedRevision: number; keyId: Id; operationId: Id; secret: string };
export type ModelCommand = Omit<GatewayCommand, 'type'> & { type: GatewayCommand['type'] | 'sync_models' };
/** Trusted composition ports must independently observe evidence; host fields alone confer no authority. */
export type ModelProofVerifier = {
  verify(
    tx: Tx,
    probe: ProbeResult,
  ): Promise<{ status: 'pass' | 'fail' | 'unverified'; capabilities: Capability[] }>;
};
export type CertificationVerifier = {
  verify(
    tx: Tx,
    input: {
      evidence: CertificationEvidence;
      challenge: CertificationChallenge;
      selection: DispatchSelection;
    },
  ): Promise<'PASS' | 'UNVERIFIED' | 'FAIL'>;
};
export type ModelRouteOptions = {
  probeVerifier?: ModelProofVerifier;
  certificationVerifier?: CertificationVerifier;
};
export const sources: Source[] = ['claude', 'codex', 'api'];
export const capabilities: Capability[] = [
  'tools',
  'vision',
  'text',
  'stream',
  'file_pdf',
  'file_docx',
  'file_xlsx',
  'file_csv',
];
const str = { type: 'string', minLength: 1, maxLength: 200 };
const nullable = (schema: unknown) => ({ anyOf: [schema, { type: 'null' }] });
const revision = { type: 'integer', minimum: 1, maximum: 2147483647 };
const capList = { type: 'array', maxItems: 8, uniqueItems: true, items: { enum: capabilities } };
export const contextSchema = objectSchema({
  ...Object.fromEntries(
    [
      'sourceTreeSha256',
      'projectionManifestSha256',
      'projectionTreeSha256',
      'derivationSha256',
      'binarySha256',
      'policySha256',
    ].map((k) => [k, digestSchema]),
  ),
  osVersion: str,
});
export const modelKeySchema = objectSchema({
  machineId: uuidSchema,
  runtime: { enum: sources },
  providerId: str,
  modelId: str,
});
export const sourceConfigSchema = objectSchema({
  expectedRevision: { type: 'integer', minimum: 0, maximum: 2147483646 },
  enabled: objectSchema({
    claude: { type: 'boolean' },
    codex: { type: 'boolean' },
    api: { type: 'boolean' },
  }),
  apiProviders: {
    type: 'array',
    maxItems: 50,
    items: objectSchema({
      id: uuidSchema,
      endpoint: { type: 'string', minLength: 1, maxLength: 2048 },
      protocol: { enum: ['responses', 'chat-completions'] },
      models: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: objectSchema({ id: str, declared: capList }),
      },
      localHttp: nullable(
        objectSchema({
          enabled: { const: true },
          allowedOrigin: { type: 'string', minLength: 1, maxLength: 200 },
        }),
      ),
    }),
  },
});
export const probeSchema = objectSchema({
  key: modelKeySchema,
  context: contextSchema,
  observedAt: { type: 'string', format: 'date-time' },
  status: { enum: ['pass', 'fail', 'unverified'] },
  capabilities: capList,
  evidenceDigest: digestSchema,
  errorCode: nullable({ type: 'string', pattern: '^[A-Z][A-Z0-9_]{0,63}$' }),
  runtimeVersion: nullable(str),
});
const envelope = (body: unknown) =>
  objectSchema({
    reportId: uuidSchema,
    bootId: uuidSchema,
    bootGeneration: counterSchema,
    sequence: counterSchema,
    configRevision: revision,
    body,
  });
export const inventorySchema = envelope(
  objectSchema({ entries: { type: 'array', maxItems: 500, items: probeSchema } }),
);
export const appliedSchema = envelope(
  objectSchema({
    inventoryReportId: uuidSchema,
    sourceStatus: objectSchema(
      Object.fromEntries(
        sources.map((s) => [
          s,
          objectSchema({
            state: { enum: ['disabled', 'ready', 'error'] },
            errorCode: nullable({ type: 'string', pattern: '^[A-Z][A-Z0-9_]{0,63}$' }),
          }),
        ]),
      ),
      [],
    ),
    observationDigest: digestSchema,
  }),
);
export const certificationSchema = objectSchema({
  challengeId: uuidSchema,
  attemptId: uuidSchema,
  fence: counterSchema,
  processInstanceId: uuidSchema,
  context: contextSchema,
  surfaceResults: {
    type: 'array',
    maxItems: 30,
    items: objectSchema({
      surface: str,
      selectedWorked: { type: 'boolean' },
      unselectedDenied: { type: 'boolean' },
      traceSha256: digestSchema,
    }),
  },
  artifactIds: { type: 'array', maxItems: 100, uniqueItems: true, items: uuidSchema },
  traceSha256: digestSchema,
});
export const registrationSchema = objectSchema({
  keyId: uuidSchema,
  publicKeyX25519: { type: 'string', minLength: 44, maxLength: 200 },
});
export const confirmationSchema = objectSchema({ challengeId: uuidSchema, challengeSha256: digestSchema });
export const secretSchema = objectSchema({
  expectedRevision: revision,
  keyId: uuidSchema,
  operationId: uuidSchema,
  secret: { type: 'string', minLength: 1, maxLength: 8192 },
});
export const secretAckSchema = objectSchema({
  operationId: uuidSchema,
  keyId: uuidSchema,
  ciphertextSha256: digestSchema,
  credentialRef: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,200}$' },
});
