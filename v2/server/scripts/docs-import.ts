import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeFileBytes, hashBytes } from '../src/docs/checksum.ts';
import type { ContentClass, DocsImport } from '../src/docs/contracts.ts';
import { validateDocsImport } from '../src/docs/import.ts';
import { validPath } from '../src/docs/manifest.ts';
import { validateDocs } from '../src/docs/validator.ts';
import { ApiError } from '../src/platform/errors.ts';

type BackupManifest = {
  version: 1;
  sourceSystem: 'crew-v1';
  exportedAt: string;
  sourceBackup: { path: string; sha256: string };
  projects: {
    legacyProjectId: string;
    sourceCommit: string | null;
    files: { path: string; sha256: string; size: number; contentClass: ContentClass }[];
  }[];
};
function fail(code: string): never {
  throw new ApiError(code, 422, 'Không thể kiểm tra hoặc nhập backup');
}
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    fail('BACKUP_MANIFEST_INVALID');
}
const sha = /^[0-9a-f]{64}$/;
function backupManifest(input: unknown): asserts input is BackupManifest {
  exact(input, ['version', 'sourceSystem', 'exportedAt', 'sourceBackup', 'projects']);
  if (
    input.version !== 1 ||
    input.sourceSystem !== 'crew-v1' ||
    typeof input.exportedAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT.*Z$/.test(input.exportedAt) ||
    !Number.isFinite(Date.parse(input.exportedAt)) ||
    !Array.isArray(input.projects) ||
    input.projects.length < 1 ||
    input.projects.length > 100
  )
    fail('BACKUP_MANIFEST_INVALID');
  exact(input.sourceBackup, ['path', 'sha256']);
  if (
    typeof input.sourceBackup.path !== 'string' ||
    !validPath(input.sourceBackup.path) ||
    typeof input.sourceBackup.sha256 !== 'string' ||
    !sha.test(input.sourceBackup.sha256)
  )
    fail('BACKUP_MANIFEST_INVALID');
  const ids = new Set<string>();
  for (const project of input.projects) {
    exact(project, ['legacyProjectId', 'sourceCommit', 'files']);
    if (
      typeof project.legacyProjectId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(project.legacyProjectId) ||
      ids.has(project.legacyProjectId) ||
      (project.sourceCommit !== null &&
        (typeof project.sourceCommit !== 'string' ||
          !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(project.sourceCommit))) ||
      !Array.isArray(project.files) ||
      project.files.length < 1 ||
      project.files.length > 2000
    )
      fail('BACKUP_MANIFEST_INVALID');
    ids.add(project.legacyProjectId);
    const paths = new Set<string>();
    for (const file of project.files) {
      exact(file, ['path', 'sha256', 'size', 'contentClass']);
      if (
        typeof file.path !== 'string' ||
        !validPath(file.path) ||
        paths.has(file.path) ||
        typeof file.sha256 !== 'string' ||
        !sha.test(file.sha256) ||
        !Number.isSafeInteger(file.size) ||
        Number(file.size) < 0 ||
        Number(file.size) > 1024 * 1024 ||
        !['implemented', 'workflow_artifact'].includes(String(file.contentClass))
      )
        fail('BACKUP_MANIFEST_INVALID');
      paths.add(file.path);
    }
  }
}
async function regularFile(path: string, maxSize?: number): Promise<void> {
  const absolute = resolve(path);
  const stat = await lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || (maxSize !== undefined && stat.size > maxSize))
    fail('BACKUP_PATH_INVALID');
  // Resolve the parent once (macOS /var itself is a system symlink), then forbid symlink components beneath it.
}
async function rootedFile(root: string, path: string): Promise<string> {
  if (!validPath(path)) fail('BACKUP_PATH_INVALID');
  const canonicalRoot = await realpath(root);
  let cursor = canonicalRoot;
  for (const segment of path.split('/')) {
    cursor = join(cursor, segment);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink()) fail('BACKUP_PATH_INVALID');
  }
  const canonical = await realpath(cursor);
  if (relative(canonicalRoot, canonical).startsWith('..')) fail('BACKUP_PATH_INVALID');
  await regularFile(canonical);
  return canonical;
}
async function fileHash(path: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer);
  return digest.digest('hex');
}

/** Reads only an explicit local export and backup inventory; never contacts v1. */
export async function verifyBackupBundle(bundlePath: string, manifestPath: string): Promise<DocsImport> {
  await regularFile(bundlePath, 24 * 1024 * 1024);
  await regularFile(manifestPath, 4 * 1024 * 1024);
  const manifestBytes = await readFile(manifestPath);
  let manifest: unknown, input: unknown;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
    input = JSON.parse((await readFile(bundlePath)).toString('utf8'));
  } catch {
    fail('BACKUP_JSON_INVALID');
  }
  backupManifest(manifest);
  validateDocsImport(input);
  if (hashBytes(manifestBytes) !== input.backupManifestSha256) fail('BACKUP_MANIFEST_CHECKSUM_MISMATCH');
  if (manifest.projects.length !== input.inventory.length) fail('BACKUP_INVENTORY_MISMATCH');
  const root = dirname(resolve(manifestPath));
  const sourceBackup = await rootedFile(root, manifest.sourceBackup.path);
  if ((await fileHash(sourceBackup)) !== manifest.sourceBackup.sha256) fail('BACKUP_CHECKSUM_MISMATCH');
  for (const project of input.inventory) {
    const inventory = manifest.projects.find((item) => item.legacyProjectId === project.legacyProjectId);
    if (
      !inventory ||
      inventory.sourceCommit !== project.sourceCommit ||
      inventory.files.length !== project.files.length
    )
      fail('BACKUP_INVENTORY_MISMATCH');
    for (const file of project.files) {
      const item = inventory.files.find((item) => item.path === file.path);
      const bytes = decodeFileBytes(file);
      if (
        !item ||
        item.sha256 !== file.sha256 ||
        item.size !== bytes.length ||
        item.contentClass !== file.contentClass
      )
        fail('BACKUP_INVENTORY_MISMATCH');
      const backupFile = await rootedFile(root, `projects/${project.legacyProjectId}/${file.path}`);
      await regularFile(backupFile, 1024 * 1024);
      const saved = await readFile(backupFile);
      if (!saved.equals(bytes) || hashBytes(saved) !== item.sha256) fail('BACKUP_FILE_MISMATCH');
    }
  }
  return input;
}

async function credentials(env: NodeJS.ProcessEnv): Promise<{ sessionCookie: string; csrfToken: string }> {
  let sessionCookie = env.CREW_V2_OWNER_SESSION,
    csrfToken = env.CREW_V2_OWNER_CSRF;
  if (!sessionCookie || !csrfToken) {
    if (process.stdin.isTTY) fail('OWNER_SESSION_REQUIRED');
    let bytes = '';
    for await (const chunk of process.stdin) {
      bytes += chunk;
      if (Buffer.byteLength(bytes) > 16384) fail('OWNER_SESSION_INVALID');
    }
    let input: unknown;
    try {
      input = JSON.parse(bytes);
    } catch {
      fail('OWNER_SESSION_INVALID');
    }
    exact(input, ['sessionCookie', 'csrfToken']);
    sessionCookie = input.sessionCookie as string;
    csrfToken = input.csrfToken as string;
  }
  if (
    typeof sessionCookie !== 'string' ||
    typeof csrfToken !== 'string' ||
    !/^[\x21-\x7e]{1,8192}$/.test(sessionCookie) ||
    !/^[\x21-\x7e]{1,4096}$/.test(csrfToken)
  )
    fail('OWNER_SESSION_INVALID');
  return { sessionCookie, csrfToken };
}
export async function runDocsImport(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, unknown>> {
  let bundlePath = '',
    manifestPath = '',
    dryRun = false;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) fail('CLI_ARGUMENT_INVALID');
    if (seen.has(arg)) fail('CLI_ARGUMENT_INVALID');
    seen.add(arg);
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    const value = args[++i];
    if (!['--bundle', '--backup-manifest'].includes(arg) || !value || value.startsWith('--'))
      fail('CLI_ARGUMENT_INVALID');
    if (arg === '--bundle') bundlePath = value;
    else manifestPath = value;
  }
  if (!bundlePath || !manifestPath) fail('CLI_ARGUMENT_INVALID');
  const input = await verifyBackupBundle(bundlePath, manifestPath);
  const audits = input.inventory.map((project) =>
    validateDocs({
      files: new Map(project.files.map((file) => [file.path, decodeFileBytes(file)])),
      contentClasses: new Map(project.files.map((file) => [file.path, file.contentClass])),
      trackedSourcePaths: [],
      mode: 'legacy_import',
    }),
  );
  const summary = {
    projects: input.inventory.length,
    files: input.inventory.reduce((n, p) => n + p.files.length, 0),
    bundleSha256: input.bundleSha256,
    backupManifestSha256: input.backupManifestSha256,
    violations: audits.reduce((n, a) => n + a.issues.filter((i) => i.severity === 'error').length, 0),
    warnings: audits.reduce((n, a) => n + a.issues.filter((i) => i.severity === 'warning').length, 0),
  };
  if (dryRun) return summary;
  let server: URL;
  try {
    server = new URL(env.CREW_V2_SERVER_URL ?? '');
  } catch {
    fail('SERVER_URL_INVALID');
  }
  if (
    server.username ||
    server.password ||
    server.search ||
    server.hash ||
    server.pathname !== '/' ||
    (server.protocol !== 'https:' &&
      !(server.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(server.hostname)))
  )
    fail('SERVER_URL_INVALID');
  const owner = await credentials(env);
  let response: Response;
  try {
    response = await fetch(new URL('/v2/docs/imports', server), {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
      headers: {
        'Content-Type': 'application/json',
        Origin: server.origin,
        Cookie: owner.sessionCookie,
        'X-CSRF-Token': owner.csrfToken,
        'Idempotency-Key': `docs-import-${input.bundleSha256}`,
      },
      body: JSON.stringify(input),
    });
  } catch {
    fail('IMPORT_TRANSPORT_FAILED');
  }
  if (!response.ok) fail('IMPORT_UPLOAD_FAILED');
  await response.body?.cancel();
  return { ...summary, uploaded: true };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await runDocsImport(process.argv.slice(2))));
  } catch (error) {
    console.error(error instanceof ApiError ? error.code : 'DOCS_IMPORT_FAILED');
    process.exitCode = 1;
  }
}
