import type { ProjectionPin, Runtime, SourcePin } from '../host/status.ts';
export type Capability =
  | 'tools'
  | 'vision'
  | 'text'
  | 'stream'
  | 'file_pdf'
  | 'file_docx'
  | 'file_xlsx'
  | 'file_csv';
export type ModelKey = { machineId: string; runtime: Runtime; providerId: string; modelId: string };
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
export type Pair = { source: SourcePin; projection: ProjectionPin };
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
  enabled: Record<Runtime, boolean>;
  apiProviders: ApiProviderConfig[];
};
export type ModelInventoryBody = { entries: ProbeResult[] };
export type ModelAppliedBody = {
  inventoryReportId: string;
  sourceStatus: Record<Runtime, { state: 'disabled' | 'ready' | 'error'; errorCode: string | null }>;
  observationDigest: string;
};
export type ModelReportEnvelope<T> = {
  reportId: string;
  bootId: string;
  bootGeneration: string;
  sequence: string;
  configRevision: number;
  body: T;
};
export type SecretEnvelope = {
  id: string;
  machineId: string;
  providerId: string;
  keyId: string;
  configRevision: number;
  operationId: string;
  expiresAt: string;
  ephemeralPublicKey: string;
  nonce: string;
  ciphertext: string;
  tag: string;
  ciphertextSha256: string;
};
export type SecretAck = {
  operationId: string;
  keyId: string;
  ciphertextSha256: string;
  credentialRef: string;
};
