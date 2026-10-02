import { randomUUID } from 'node:crypto';
import { canonicalJson } from '../journal/canonical.ts';
import { appendEvent } from '../journal/events.ts';
import type { Actor, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import { createProject } from '../projects/service.ts';
import { bundleHash, decodeFileBytes, hashBytes, snapshotHash, sourceTreeHash } from './checksum.ts';
import type { DocsFile, DocsImport, DocsSync, DocsValidationResult, ImportResult } from './contracts.ts';
import { allowedDocsPath, requiredClass, validPath } from './manifest.ts';
import { validateDocs } from './validator.ts';

const sha = /^[0-9a-f]{64}$/;
const commit = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(code: string, status = 422): never {
  throw new ApiError(code, status, 'Dữ liệu tài liệu không hợp lệ');
}
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail('VALIDATION', 400);
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length ||
    own.some(
      (key) =>
        typeof key !== 'string' ||
        !keys.includes(key) ||
        !('value' in (Object.getOwnPropertyDescriptor(value, key) ?? {})),
    )
  )
    fail('VALIDATION', 400);
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= max && !value.includes('\0');
}
function repo(value: unknown): boolean {
  if (value === null) return true;
  if (!text(value, 4096)) return false;
  try {
    const url = new URL(value);
    return ['https:', 'ssh:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}
function encodedLimit(input: unknown): void {
  try {
    if (Buffer.byteLength(canonicalJson(input)) > 24 * 1024 * 1024) fail('IMPORT_TOO_LARGE', 413);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail('VALIDATION', 400);
  }
}
function checkedFiles(files: unknown): {
  files: DocsFile[];
  buffers: Map<string, Buffer>;
  contentClass: 'implemented' | 'workflow_artifact' | 'mixed';
  size: number;
} {
  if (!Array.isArray(files) || files.length === 0) fail('VALIDATION', 400);
  if (files.length > 2000) fail('FILE_COUNT_LIMIT', 413);
  const buffers = new Map<string, Buffer>();
  const classes = new Set<string>();
  let size = 0;
  for (const file of files) {
    exact(file, ['path', 'bytesBase64', 'sha256', 'contentClass']);
    if (typeof file.path !== 'string' || !allowedDocsPath(file.path)) fail('PATH_INVALID');
    if (
      typeof file.bytesBase64 !== 'string' ||
      typeof file.sha256 !== 'string' ||
      !sha.test(file.sha256) ||
      !['implemented', 'workflow_artifact'].includes(String(file.contentClass))
    )
      fail('VALIDATION', 400);
    if (buffers.has(file.path)) fail('DUPLICATE_PATH');
    const required = requiredClass(file.path);
    if (required !== null && required !== file.contentClass) fail('CONTENT_CLASS_MISMATCH');
    let bytes: Buffer;
    try {
      bytes = decodeFileBytes(file as DocsFile);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      fail(
        ['INVALID_BASE64', 'CHECKSUM_MISMATCH', 'FILE_TOO_LARGE'].includes(code) ? code : 'INVALID_UTF8',
        code === 'FILE_TOO_LARGE' ? 413 : 422,
      );
    }
    buffers.set(file.path, bytes);
    classes.add(file.contentClass as string);
    size += bytes.length;
    if (size > 16 * 1024 * 1024) fail('IMPORT_TOO_LARGE', 413);
  }
  return {
    files: files as DocsFile[],
    buffers,
    contentClass:
      classes.size > 1 ? 'mixed' : classes.has('implemented') ? 'implemented' : 'workflow_artifact',
    size,
  };
}
const indexedPrefixCharacters = 8192;
const storageProjection = {
  version: 1,
  nulEncoding: 'literal-backslash-u0000',
  rawByteColumn: 'docs_files.bytes',
  indexedPrefixCharacters,
  fullSearchText: true,
} as const;

/** Only for PostgreSQL text/jsonb projections; raw bytes and validation remain authoritative. */
export function projectStorageText(value: string): string {
  return value.replaceAll('\u0000', '\\u0000');
}

function beyondIndexedPrefix(value: string): boolean {
  let count = 0;
  for (const _character of value) if (++count > indexedPrefixCharacters) return true;
  return false;
}

export function auditDocsForStorage(
  files: DocsFile[],
  buffers: Map<string, Buffer>,
  mode: 'legacy_import' | 'checkout_sync',
  trackedSourcePaths: string[] = [],
): DocsValidationResult {
  const result = validateDocs({
    files: buffers,
    contentClasses: new Map(files.map((f) => [f.path, f.contentClass])),
    trackedSourcePaths,
    mode,
  });
  const security = result.issues.find(
    (issue) => issue.code === 'LINK_PATH_ESCAPE' || issue.code === 'PATH_INVALID',
  );
  if (security) fail(security.code);
  const issues = result.issues.map((issue) => ({
    ...issue,
    path: projectStorageText(issue.path),
    message: projectStorageText(issue.message),
  }));
  for (const file of files) {
    const bytes = buffers.get(file.path);
    if (!bytes) throw new Error('DOCS_BYTES_MISSING');
    const page = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const derivedNul =
      result.links.some(
        (link) =>
          link.fromPath === file.path &&
          [link.originalHref, link.toPath, link.fragment].some((value) => value?.includes('\u0000')),
      ) || result.issues.some((issue) => issue.path === file.path && issue.message.includes('\u0000'));
    if (page.includes('\u0000') || derivedNul)
      issues.push({
        code: 'STORAGE_NUL_PROJECTION',
        path: file.path,
        severity: 'warning',
        message:
          'Byte gốc giữ nguyên; U+0000 trong text/link/audit được biểu diễn bằng chuỗi literal \\u0000, không phải nội dung gốc.',
      });
    if (beyondIndexedPrefix(projectStorageText(page)))
      issues.push({
        code: 'FTS_PREFIX_ONLY',
        path: file.path,
        severity: 'warning',
        message:
          'FTS chỉ lập chỉ mục 8192 ký tự đầu của projection; search_text đầy đủ cần fallback tìm literal có giới hạn để tìm phần còn lại.',
      });
  }
  const links = result.links.map((link) => ({
    ...link,
    fromPath: projectStorageText(link.fromPath),
    originalHref: projectStorageText(link.originalHref),
    toPath: projectStorageText(link.toPath),
    fragment: link.fragment === null ? null : projectStorageText(link.fragment),
  }));
  return { ...result, issues, links };
}

/** Validates all transport/integrity fields before any database mutation. Structural legacy errors remain auditable. */
export function validateDocsImport(input: unknown): asserts input is DocsImport {
  exact(input, ['sourceSystem', 'backupManifestSha256', 'bundleSha256', 'inventory']);
  if (
    input.sourceSystem !== 'crew-v1' ||
    typeof input.backupManifestSha256 !== 'string' ||
    !sha.test(input.backupManifestSha256) ||
    typeof input.bundleSha256 !== 'string' ||
    !sha.test(input.bundleSha256) ||
    !Array.isArray(input.inventory) ||
    input.inventory.length === 0
  )
    fail('VALIDATION', 400);
  if (input.inventory.length > 100) fail('PROJECT_COUNT_LIMIT', 413);
  encodedLimit(input);
  const legacyIds = new Set<string>(),
    keys = new Set<string>();
  let total = 0;
  for (const item of input.inventory) {
    exact(item, [
      'legacyProjectId',
      'key',
      'name',
      'repositoryUrl',
      'sourceCommit',
      'snapshotSha256',
      'files',
    ]);
    if (
      !text(item.legacyProjectId, 200) ||
      !text(item.key, 32) ||
      !/^[A-Z][A-Z0-9_-]{1,31}$/.test(item.key) ||
      !text(item.name, 200) ||
      !repo(item.repositoryUrl) ||
      (item.sourceCommit !== null &&
        (typeof item.sourceCommit !== 'string' || !commit.test(item.sourceCommit))) ||
      typeof item.snapshotSha256 !== 'string' ||
      !sha.test(item.snapshotSha256)
    )
      fail('VALIDATION', 400);
    if (legacyIds.has(item.legacyProjectId) || keys.has(item.key)) fail('DUPLICATE_PROJECT', 400);
    legacyIds.add(item.legacyProjectId);
    keys.add(item.key);
    const checked = checkedFiles(item.files);
    total += checked.size;
    if (total > 16 * 1024 * 1024) fail('IMPORT_TOO_LARGE', 413);
    if (snapshotHash(checked.files) !== item.snapshotSha256) fail('SNAPSHOT_CHECKSUM_MISMATCH');
    auditDocsForStorage(checked.files, checked.buffers, 'legacy_import');
  }
  const { bundleSha256, ...body } = input;
  if (bundleHash(body as Omit<DocsImport, 'bundleSha256'>) !== bundleSha256) fail('BUNDLE_CHECKSUM_MISMATCH');
}

async function storeSnapshot(
  tx: Tx,
  input: {
    id: Id;
    projectId: Id;
    importId: Id | null;
    sourceCommit: string | null;
    snapshotSha: string;
    sourceKind: 'legacy_import' | 'checkout_sync';
    auditState: 'invalid' | 'unverified';
    files: DocsFile[];
    result: DocsValidationResult;
    proof?: { sourceTreeSha256: string; verificationEvidenceId: Id; inputSha256: string };
  },
): Promise<void> {
  const checked = checkedFiles(input.files);
  await tx`insert into docs_snapshots(id,project_id,import_id,source_commit,snapshot_sha,source_kind,audit_state,audit_report,content_class) values(${input.id},${input.projectId},${input.importId},${input.sourceCommit},${input.snapshotSha},${input.sourceKind},${input.auditState},${tx.json({ issues: input.result.issues, storageProjection, ...input.proof })},${checked.contentClass})`;
  for (const file of input.files) {
    const bytes = checked.buffers.get(file.path);
    if (!bytes) throw new Error('DOCS_BYTES_MISSING');
    const page = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const title = projectStorageText(/^# (.+)$/m.exec(page)?.[1]?.replace(/\r$/, '') ?? file.path);
    const searchText = projectStorageText(page);
    await tx`insert into docs_files(snapshot_id,path,content_class,bytes,sha,title,search_text) values(${input.id},${file.path},${file.contentClass},${bytes},${file.sha256},${title},${searchText})`;
  }
  for (const link of input.result.links)
    await tx`insert into docs_links(snapshot_id,from_path,occurrence,original_href,to_path,fragment,status) values(${input.id},${link.fromPath},${link.occurrence},${link.originalHref},${link.toPath},${link.fragment},${link.status})`;
}

export async function importDocs(tx: Tx, input: DocsImport, actor: Actor): Promise<ImportResult> {
  if (actor.kind !== 'owner' || actor.id !== 'owner') fail('OWNER_REQUIRED', 403);
  validateDocsImport(input);
  // Journal's global lock precedes entity locks, including calls made without the HTTP mutator.
  await tx`select value from event_cursor where singleton=true for update`;
  await tx`select pg_advisory_xact_lock(hashtextextended('crew-v2-docs-import',0))`;
  const [known] =
    await tx`select report from docs_imports where source_system=${input.sourceSystem} and bundle_sha=${input.bundleSha256}`;
  if (known) return known.report as ImportResult;
  const importId = randomUUID();
  const result: ImportResult = { importId, projects: [] };
  const pending: Parameters<typeof storeSnapshot>[1][] = [];
  for (const item of input.inventory) {
    const [mapping] =
      await tx`select p.* from legacy_projects l join projects p on p.id=l.project_id where l.source_system=${input.sourceSystem} and l.legacy_id=${item.legacyProjectId} for update of p`;
    let projectId: Id;
    if (mapping) {
      if (mapping.key !== item.key || mapping.repository_url !== item.repositoryUrl)
        fail('LEGACY_PROVENANCE_CONFLICT', 409);
      projectId = mapping.id as Id;
    } else {
      const [collision] = await tx`select id from projects where key=${item.key}`;
      if (collision) fail('PROJECT_KEY_CONFLICT', 409);
      projectId = (
        await createProject(tx, { key: item.key, name: item.name, repositoryUrl: item.repositoryUrl })
      ).id;
      await tx`insert into legacy_projects(source_system,legacy_id,project_id) values(${input.sourceSystem},${item.legacyProjectId},${projectId})`;
    }
    const checked = checkedFiles(item.files);
    const validation = auditDocsForStorage(item.files, checked.buffers, 'legacy_import');
    const [snapshot] =
      await tx`select id,audit_state,audit_report from docs_snapshots where project_id=${projectId} and source_kind='legacy_import' and snapshot_sha=${item.snapshotSha256} and content_class=${checked.contentClass} and coalesce(source_commit,'')=${item.sourceCommit ?? ''}`;
    const snapshotId = (snapshot?.id as Id) ?? randomUUID();
    const auditState: 'invalid' | 'unverified' = snapshot
      ? (snapshot.audit_state as 'invalid' | 'unverified')
      : validation.valid
        ? 'unverified'
        : 'invalid';
    result.projects.push({
      projectId,
      legacyProjectId: item.legacyProjectId,
      snapshotId,
      auditState,
      issues: snapshot ? snapshot.audit_report.issues : validation.issues,
    });
    if (!snapshot)
      pending.push({
        id: snapshotId,
        projectId,
        importId,
        sourceCommit: item.sourceCommit,
        snapshotSha: item.snapshotSha256,
        sourceKind: 'legacy_import',
        auditState,
        files: item.files,
        result: validation,
      });
  }
  await tx`insert into docs_imports(id,source_system,backup_manifest_sha,bundle_sha,report) values(${importId},${input.sourceSystem},${input.backupManifestSha256},${input.bundleSha256},${tx.json(result)})`;
  for (const snapshot of pending) await storeSnapshot(tx, snapshot);
  for (const project of result.projects)
    await tx`update projects set latest_imported_snapshot_id=${project.snapshotId} where id=${project.projectId}`;
  await appendEvent(tx, {
    type: 'docs.imported',
    projectId: null,
    ticketId: null,
    audienceMachineId: null,
    data: { importId, projectCount: result.projects.length },
  });
  return result;
}

function checkedSync(input: DocsSync): ReturnType<typeof checkedFiles> {
  exact(input, [
    'sourceCommit',
    'snapshotSha256',
    'files',
    'attemptId',
    'fence',
    'trackedSourcePaths',
    'sourceTreeSha256',
    'verificationEvidenceId',
  ]);
  if (
    typeof input.sourceCommit !== 'string' ||
    !commit.test(input.sourceCommit) ||
    typeof input.snapshotSha256 !== 'string' ||
    !sha.test(input.snapshotSha256) ||
    typeof input.attemptId !== 'string' ||
    !uuid.test(input.attemptId) ||
    typeof input.fence !== 'string' ||
    !/^[1-9][0-9]{0,18}$/.test(input.fence) ||
    typeof input.sourceTreeSha256 !== 'string' ||
    !sha.test(input.sourceTreeSha256) ||
    typeof input.verificationEvidenceId !== 'string' ||
    !uuid.test(input.verificationEvidenceId) ||
    !Array.isArray(input.trackedSourcePaths) ||
    input.trackedSourcePaths.length > 100000 ||
    input.trackedSourcePaths.some((path) => typeof path !== 'string' || !validPath(path)) ||
    new Set(input.trackedSourcePaths).size !== input.trackedSourcePaths.length
  )
    fail('VALIDATION', 400);
  encodedLimit(input);
  const checked = checkedFiles(input.files);
  if (snapshotHash(input.files) !== input.snapshotSha256) fail('SNAPSHOT_CHECKSUM_MISMATCH');
  if (sourceTreeHash(input.trackedSourcePaths) !== input.sourceTreeSha256)
    fail('SOURCE_TREE_CHECKSUM_MISMATCH');
  return checked;
}

/** Must be supplied as MutationContext.authorize to recheck authority even when a response is cached. */
export async function authorizeDocsSync(tx: Tx, projectId: Id, input: DocsSync, actor: Actor): Promise<void> {
  checkedSync(input);
  if (actor.kind !== 'machine') fail('MACHINE_REQUIRED', 403);
  if (!uuid.test(projectId)) fail('NOT_FOUND', 404);
  await tx`select value from event_cursor where singleton=true for update`;
  const [scope] =
    await tx`select t.root_id from attempts a join tickets t on t.id=a.ticket_id where a.id=${input.attemptId} and t.project_id=${projectId} and a.machine_id=${actor.id}`;
  if (!scope) fail('NOT_FOUND', 404);
  await tx`select id from tickets where id=${scope.root_id} for update`;
  const [row] =
    await tx`select a.*,t.merged_commit,g.active_attempt_id,g.fence as guard_fence,c.binding_revision as command_binding_revision,c.machine_id as command_machine_id,c.ticket_id as command_ticket_id,c.type as command_type from attempts a join tickets t on t.id=a.ticket_id join execution_guards g on g.ticket_id=t.id join commands c on c.id=a.command_id where a.id=${input.attemptId} for update of t,g,a,c`;
  const [project] =
    await tx`select machine_id,binding_revision from projects where id=${projectId} for update`;
  const [machine] = await tx`select id from machines where id=${actor.id} and revoked_at is null for share`;
  if (!row || !project || !machine || project.machine_id !== actor.id) fail('NOT_FOUND', 404);
  if (
    String(row.fence) !== input.fence ||
    row.active_attempt_id !== input.attemptId ||
    String(row.guard_fence) !== input.fence
  )
    fail('STALE_FENCE', 409);
  if (
    Number(project.binding_revision) !== Number(row.binding_revision) ||
    Number(row.command_binding_revision) !== Number(row.binding_revision) ||
    row.command_machine_id !== actor.id ||
    row.command_ticket_id !== row.ticket_id ||
    !['start', 'resume'].includes(String(row.command_type))
  )
    fail('STALE_BINDING', 409);
  if (
    !['active', 'finalizing'].includes(String(row.state)) ||
    row.terminal_intent !== 'complete' ||
    row.finalized_at !== null ||
    (row.state === 'active' && (row.lease_expires_at as Date).getTime() <= Date.now())
  )
    fail('DOCS_SYNC_NOT_ALLOWED', 409);
  if (row.merged_commit !== input.sourceCommit) fail('DOCS_COMMIT_MISMATCH', 409);
  const [evidence] =
    await tx`select data from evidence where id=${input.verificationEvidenceId} and ticket_id=${row.ticket_id} and attempt_id=${input.attemptId} and kind='docs_verification'`;
  if (
    !evidence ||
    evidence.data?.sourceCommit !== input.sourceCommit ||
    evidence.data?.sourceTreeSha256 !== input.sourceTreeSha256
  )
    fail('DOCS_PROVENANCE_INVALID', 422);
}

export async function syncDocs(tx: Tx, projectId: Id, input: DocsSync, actor: Actor): Promise<Id> {
  const checked = checkedSync(input);
  await authorizeDocsSync(tx, projectId, input, actor);
  const validation = auditDocsForStorage(
    input.files,
    checked.buffers,
    'checkout_sync',
    input.trackedSourcePaths,
  );
  if (!validation.valid) fail('DOCS_INVALID');
  const inputSha256 = hashBytes(Buffer.from(canonicalJson(input)));
  const [receipt] =
    await tx`select s.id,r.input_sha256 from docs_sync_receipts r join docs_snapshots s on s.id=r.snapshot_id where r.attempt_id=${input.attemptId} and r.merged_commit=${input.sourceCommit}`;
  if (receipt) {
    if (receipt.input_sha256 !== inputSha256) fail('DOCS_SYNC_CONFLICT', 409);
    return receipt.id as Id;
  }
  const [known] =
    await tx`select id from docs_snapshots where project_id=${projectId} and source_kind='checkout_sync' and snapshot_sha=${input.snapshotSha256} and content_class=${checked.contentClass} and source_commit=${input.sourceCommit}`;
  const id = (known?.id as Id) ?? randomUUID();
  // Evidence from the host is provenance, not trusted verification. Phase 08 supplies the trusted verifier.
  if (!known)
    await storeSnapshot(tx, {
      id,
      projectId,
      importId: null,
      sourceCommit: input.sourceCommit,
      snapshotSha: input.snapshotSha256,
      sourceKind: 'checkout_sync',
      auditState: 'unverified',
      files: input.files,
      result: validation,
      proof: {
        sourceTreeSha256: input.sourceTreeSha256,
        verificationEvidenceId: input.verificationEvidenceId,
        inputSha256,
      },
    });
  await tx`insert into docs_sync_receipts(attempt_id,merged_commit,snapshot_id,input_sha256) values(${input.attemptId},${input.sourceCommit},${id},${inputSha256})`;
  await appendEvent(tx, {
    type: 'docs.synced',
    projectId,
    ticketId: null,
    audienceMachineId: null,
    data: { snapshotId: id, sourceCommit: input.sourceCommit, auditState: 'unverified' },
  });
  return id;
}
