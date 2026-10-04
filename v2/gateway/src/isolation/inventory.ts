import { constants } from 'node:fs';
import { lstat, open, readdir, readlink, realpath } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { hash } from '../journal/atomic-records.ts';
import type { ExecutionReceipt } from '../workflows/operations.ts';
import type { ManifestEntry, ProjectionPin, Runtime, SourcePin } from '../workflows/pins.ts';

export type InventoryEntry = {
  path: string;
  type: 'file' | 'directory' | 'symlink';
  sha256: string | null;
  mode: number;
  bytes: number;
  target?: string;
  classification: 'product' | 'discovery' | 'selected' | 'runtime-system';
  reason: string | null;
};
/**
 * Runtime-discovery paths the workspace placed itself as regular copies: exact files with their pinned
 * SHA-256, the directories holding them, and one directory whose contents a measured generator
 * writes. Inside the roots these paths span, anything undeclared is a blocker.
 */
export type InjectedDeclaration = {
  files: Record<string, string>;
  directories: string[];
  generated: string;
};
export type Surface = {
  surface: string;
  status: 'PASS' | 'FAIL' | 'UNVERIFIED';
  measured: boolean;
  reason: string;
};
export type CommandEvidence = {
  operationId: string;
  argv: string[];
  executable: string;
  executableSha256: string;
  policySha256: string;
  policy: string;
  stageIdentity: { device: string; inode: string; ownerUid: number } | null;
  output: string;
  receipt: ExecutionReceipt | null;
  error: string | null;
  stdin?: { path: string; device: number; inode: number; ownerUid: number; sha256: string; body: string };
  numericPidStart: 'unavailable-in-reviewed-receipt';
};
export type InventoryEvidence = {
  formatVersion: 1;
  runtime: Runtime;
  source: SourcePin;
  projection: ProjectionPin;
  workspace: string;
  attemptHome: string;
  os: { platform: string; release: string; arch: string };
  productionEnabled: false;
  policyVersion: string;
  commands: CommandEvidence[];
  entries: InventoryEntry[];
  projectionEntries: ManifestEntry[];
  exclusions: InventoryEntry[];
  surfaces: Surface[];
  discovery: unknown;
  origins: DiscoveryOrigin[];
  blockers: string[];
  sha256: string;
};
export type DiscoveryOrigin = {
  path: string;
  kind: string;
  classification: 'selected' | 'runtime-system' | 'blocked' | 'unverified';
  sha256: string | null;
};
export async function classifyOrigin(
  path: string,
  kind: string,
  projectionRoot: string,
  attemptHome: string,
  workspace?: string,
): Promise<DiscoveryOrigin> {
  const system = join(attemptHome, 'codex/skills/.system');
  const result: DiscoveryOrigin = {
    path: '<outside-boundary>',
    kind,
    classification: 'blocked',
    sha256: null,
  };
  if (
    !contained(projectionRoot, path) &&
    !contained(system, path) &&
    !(workspace && contained(workspace, path))
  )
    return result;
  const actual = await realpath(path).catch(() => null);
  if (!actual) return { ...result, path: '<missing>', classification: 'unverified' };
  if (contained(projectionRoot, actual)) {
    result.classification = 'selected';
    result.path = `$PROJECTION/${relative(projectionRoot, actual)}`;
  } else if (contained(system, actual)) {
    result.classification = 'runtime-system';
    result.path = `$ATTEMPT_HOME/codex/skills/.system/${relative(system, actual)}`;
  } else return result;
  const s = await lstat(actual);
  if (s.isFile()) {
    if (s.nlink !== 1) return { ...result, classification: 'blocked' };
    result.sha256 = await fileDigest(actual);
  }
  return result;
}
const directories = new Set([
  '.agents',
  '.claude',
  '.codex',
  '.gemini',
  '.cursor',
  '.windsurf',
  '.opencode',
  '_bmad',
  '.bmad',
  '.superpowers',
]);
const files = new Set([
  'AGENTS.md',
  'AGENTS.override.md',
  'CLAUDE.md',
  'CLAUDE.local.md',
  'GEMINI.md',
  '.mcp.json',
  '.cursorrules',
  '.windsurfrules',
]);
export function discoveryReason(path: string): string | null {
  const parts = path.split('/');
  if (parts.some((p) => directories.has(p))) return 'runtime-discovery-directory';
  if (files.has(basename(path))) return 'runtime-instruction-or-configuration';
  if (path === '.github/copilot-instructions.md' || path.startsWith('.github/instructions/'))
    return 'runtime-instructions';
  return null;
}
export function contained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep));
}
export async function fileDigest(path: string): Promise<string> {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await fd.stat();
    if (!s.isFile() || s.nlink !== 1 || s.size > 32 * 1024 * 1024) throw new Error('UNSAFE_INVENTORY_FILE');
    return hash(await fd.readFile());
  } finally {
    await fd.close();
  }
}
export async function auditWorkspace(
  root: string,
  selectedMount?: { path: string; target: string },
  executableTargets: readonly string[] = [],
  separatelyAuditedGitRoot?: string,
  injected?: InjectedDeclaration,
): Promise<{ entries: InventoryEntry[]; blockers: string[] }> {
  if ((await realpath(root)) !== root) throw new Error('WORKSPACE_ALIAS');
  if (separatelyAuditedGitRoot !== undefined && separatelyAuditedGitRoot !== join(root, '.git'))
    throw new Error('INVALID_GIT_AUDIT_BOUNDARY');
  const entries: InventoryEntry[] = [],
    blockers: string[] = [];
  let total = 0;
  const injectedFiles = new Map(Object.entries(injected?.files ?? {}));
  const injectedDirectories = new Set(injected?.directories ?? []);
  const injectedRoots = new Set(
    [...injectedFiles.keys(), ...injectedDirectories, ...(injected ? [injected.generated] : [])].map(
      (path) => path.split('/')[0],
    ),
  );
  const seen = new Set<string>();
  // How an injected path is declared, or null when it lies outside every declared root.
  const declaration = (rel: string): 'file' | 'directory' | 'generated' | 'undeclared' | null => {
    if (!injected || !injectedRoots.has(rel.split('/')[0])) return null;
    if (injectedFiles.has(rel)) return 'file';
    if (injectedDirectories.has(rel)) return 'directory';
    if (rel.startsWith(`${injected.generated}/`)) return 'generated';
    return 'undeclared';
  };
  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > 100 || entries.length > 30000) throw new Error('INVENTORY_LIMIT');
    for (const name of (await readdir(dir)).sort()) {
      const full = join(dir, name),
        rel = relative(root, full).split(sep).join('/');
      // Only the exact execution workspace has a separate immutable Git inventory.
      if (full === separatelyAuditedGitRoot) continue;
      if (name === '.git') {
        blockers.push(`GIT_DISCOVERY:${rel}`);
        continue;
      }
      const s = await lstat(full),
        reason = discoveryReason(rel);
      const entry: InventoryEntry = {
        path: rel,
        type: s.isSymbolicLink() ? 'symlink' : s.isDirectory() ? 'directory' : 'file',
        mode: s.mode & 0o777,
        bytes: s.size,
        sha256: null,
        classification: reason ? 'discovery' : 'product',
        reason,
      };
      entries.push(entry);
      if (s.uid !== process.getuid?.()) blockers.push(`FOREIGN_OWNER:${rel}`);
      const declared = declaration(rel);
      if (declared !== null) {
        seen.add(rel);
        if (declared === 'undeclared') blockers.push(`UNDECLARED_INJECTION:${rel}`);
        else if (s.isSymbolicLink()) blockers.push(`INJECTED_SYMLINK:${rel}`);
        else if (declared === 'file' && !s.isFile()) blockers.push(`INJECTED_BYTES:${rel}`);
        else if (declared === 'directory' && !s.isDirectory()) blockers.push(`INJECTED_BYTES:${rel}`);
        else {
          entry.classification = 'selected';
          entry.reason =
            declared === 'generated' || rel === injected?.generated ? 'render-output' : 'render-input';
        }
      }
      if (s.isSymbolicLink()) {
        entry.target = await readlink(full);
        const target = await realpath(full).catch(() => null);
        if (selectedMount && rel === selectedMount.path && target === selectedMount.target)
          entry.classification = 'selected';
        else if (target && executableTargets.includes(target)) entry.classification = 'runtime-system';
        else if (!target || !contained(root, target)) blockers.push(`SYMLINK_ORIGIN:${rel}`);
      } else if (s.isDirectory()) await visit(full, depth + 1);
      else if (s.isFile()) {
        total += s.size;
        if (total > 256 * 1024 * 1024) throw new Error('INVENTORY_LIMIT');
        if (s.nlink !== 1) blockers.push(`HARDLINK:${rel}`);
        else entry.sha256 = await fileDigest(full);
        if (declared === 'file' && entry.sha256 !== injectedFiles.get(rel)) {
          blockers.push(`INJECTED_BYTES:${rel}`);
          entry.classification = 'discovery';
          entry.reason = reason;
        }
      } else blockers.push(`SPECIAL_FILE:${rel}`);
    }
  }
  await visit(root, 0);
  for (const path of [...injectedFiles.keys(), ...injectedDirectories])
    if (!seen.has(path)) blockers.push(`INJECTED_MISSING:${path}`);
  return { entries, blockers };
}
