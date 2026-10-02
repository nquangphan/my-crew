import type { Id } from '../platform/contracts.ts';

export type ContentClass = 'implemented' | 'workflow_artifact';
export type DocsFile = { path: string; bytesBase64: string; sha256: string; contentClass: ContentClass };
export type AuditIssue = { code: string; path: string; message: string; severity: 'error' | 'warning' };
export type DocsImport = {
  sourceSystem: 'crew-v1';
  backupManifestSha256: string;
  bundleSha256: string;
  inventory: {
    legacyProjectId: string;
    key: string;
    name: string;
    repositoryUrl: string | null;
    sourceCommit: string | null;
    snapshotSha256: string;
    files: DocsFile[];
  }[];
};
export type ImportResult = {
  importId: Id;
  projects: {
    projectId: Id;
    legacyProjectId: string;
    snapshotId: Id;
    auditState: 'unverified' | 'invalid';
    issues: AuditIssue[];
  }[];
};
export type DocsSync = {
  sourceCommit: string;
  snapshotSha256: string;
  files: DocsFile[];
  attemptId: Id;
  fence: string;
  trackedSourcePaths: string[];
  sourceTreeSha256: string;
  verificationEvidenceId: Id;
};
export type DocsValidationInput = {
  files: Map<string, Buffer>;
  contentClasses: Map<string, ContentClass>;
  trackedSourcePaths: string[];
  mode: 'legacy_import' | 'checkout_sync';
};
export type DocLink = {
  fromPath: string;
  occurrence: number;
  originalHref: string;
  toPath: string;
  fragment: string | null;
  status: 'ok' | 'missing' | 'external' | 'unverified';
};
export type DocsValidationResult = { issues: AuditIssue[]; valid: boolean; links: DocLink[] };
