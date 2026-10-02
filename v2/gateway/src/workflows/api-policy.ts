import { canonicalJson, hash } from '../journal/atomic-records.ts';
import type { SourcePin } from './pins.ts';
import type { TreeFile } from './stage.ts';

// This is adapter transport policy, never a Crew role prompt or an execution certificate.
export function apiPolicy(source: SourcePin, files: TreeFile[], buildInputs: unknown = null): string {
  const officialInventory = files
    .filter((f) => f.type === 'file')
    .map((f) => ({ path: f.path, sha256: hash(f.body) }))
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const skills = officialInventory.filter((f) => f.path.endsWith('/SKILL.md'));
  const executablePaths = new Set(
    files.filter((f) => f.type === 'file' && f.mode === 0o755).map((f) => f.path),
  );
  const scripts = officialInventory.filter(
    (f) => executablePaths.has(f.path) || /\.(?:py|sh|js|cjs|mjs)$/.test(f.path),
  );
  if (!skills.length) throw new Error('OFFICIAL_ENTRYPOINT_MISSING');
  return canonicalJson({
    formatVersion: 1,
    runtime: 'api',
    sourceTreeSha256: source.sourceTreeSha256,
    officialInventory,
    skills,
    scripts,
    buildInputs,
    transport: {
      instructionBytes: 'exact-official-selected-skill',
      allowUnlistedSkills: false,
      allowUnlistedScripts: false,
    },
    tools: {
      read: 'per-call-pinned-manifest-and-owner-path-grant',
      write: 'per-call-owned-worktree-grant-and-effect-ledger',
      execute: 'per-call-listed-script-and-certified-boundary',
      network: 'per-call-owner-grant',
      effectLedgerRequired: true,
      secretRedactionRequired: true,
    },
    modelRequestsEnabled: false,
    toolExecutionEnabled: false,
    isolationCertificate: null,
  });
}
