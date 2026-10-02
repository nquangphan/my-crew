import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, hash } from '../journal/atomic-records.ts';
import { projectionTreeHash, type SourcePin, validateSourcePin } from './pins.ts';
import type { ProjectionAudit } from './registry.ts';
import { manifest, manifestHash, parseArchive, type TreeFile, validateFiles } from './stage.ts';
export const NATIVE_SKILLS = [
  'brainstorming',
  'diagnosing-superpowers',
  'dispatching-parallel-agents',
  'executing-plans',
  'finishing-a-development-branch',
  'receiving-code-review',
  'requesting-code-review',
  'subagent-driven-development',
  'systematic-debugging',
  'test-driven-development',
  'using-git-worktrees',
  'using-superpowers',
  'verification-before-completion',
  'writing-plans',
  'writing-skills',
] as const;
export function nativeFiles(source: TreeFile[]): TreeFile[] {
  if (
    !source.some((f) => f.path === '.agents' && f.type === 'dir') ||
    !source.some((f) => f.path === 'skills/using-superpowers/references/codex-tools.md')
  )
    throw new Error('OFFICIAL_ENTRYPOINT_MISSING');
  if (source.some((f) => f.path === '.agents/skills' || f.path.startsWith('.agents/skills/')))
    throw new Error('NATIVE_DISCOVERY_COLLISION');
  if (source.filter((f) => /^skills\/[^/]+\/SKILL.md$/.test(f.path) && f.type === 'file').length !== 15)
    throw new Error('NATIVE_INVENTORY_MISMATCH');
  for (const name of NATIVE_SKILLS)
    if (!source.some((f) => f.type === 'file' && f.path === `skills/${name}/SKILL.md`))
      throw new Error('OFFICIAL_ENTRYPOINT_MISSING');
  return validateFiles([
    ...source.map((f) => ({ ...f, body: Buffer.from(f.body) })),
    { path: '.agents/skills', type: 'dir', mode: 0o755, body: Buffer.alloc(0) },
    ...NATIVE_SKILLS.map((name) => ({
      path: `.agents/skills/${name}`,
      type: 'symlink' as const,
      mode: null,
      target: `../../skills/${name}`,
      body: Buffer.from(`../../skills/${name}`),
    })),
  ]);
}
export async function verifyNativeGeometry(root: string): Promise<void> {
  const canonical = await realpath(root);
  for (const name of NATIVE_SKILLS) {
    const target = await realpath(join(root, '.agents/skills', name));
    if (target !== join(canonical, 'skills', name)) throw new Error('NATIVE_GEOMETRY_MISMATCH');
  }
  for (const resource of [
    'subagent-driven-development/scripts/sdd-workspace',
    'subagent-driven-development/scripts/review-package',
    'requesting-code-review/code-reviewer.md',
  ]) {
    const expected = join(canonical, 'skills', resource);
    if ((await realpath(join(root, '.agents/skills', resource))) !== expected)
      throw new Error('NATIVE_GEOMETRY_MISMATCH');
  }
}
export async function auditSuperpowersNative(
  source: SourcePin,
  bytes: Buffer,
  executables: string[],
  protocolEvidenceSha256: string,
): Promise<ProjectionAudit> {
  validateSourcePin(source);
  if (
    source.name !== 'superpowers' ||
    hash(bytes) !== source.payloadSha256 ||
    !/^[a-f0-9]{64}$/.test(protocolEvidenceSha256)
  )
    throw new Error('CHECKSUM_MISMATCH');
  const files = await parseArchive(bytes, executables);
  if (manifestHash(manifest(files)) !== source.sourceManifestSha256) throw new Error('CHECKSUM_MISMATCH');
  const policy = canonicalJson({
    kind: 'Crew-audited-native-projection-of-official-source',
    sourceTreeSha256: source.sourceTreeSha256,
    sourceManifestSha256: source.sourceManifestSha256,
    executables,
    skills: NATIVE_SKILLS,
    additions: { directory: '.agents/skills', target: '../../skills/<exact-name>', linkMode: null },
    preserve: 'full-upstream-bytes-modes-and-support-geometry',
    bootstrap: {
      firstInput: '$using-superpowers+exact-native-skill-item',
      reference: 'skills/using-superpowers/references/codex-tools.md',
      subagentStop: 'original-context',
    },
    namespace: 'superpowers:* transitions require real Phase04 proof; no alias router',
    protocol: {
      cli: '0.159.3',
      evidenceSha256: protocolEvidenceSha256,
      skillsListParams: ['cwds', 'forceReload'],
    },
    consumer: {
      projection: 'sibling-outside-CWD-and-ancestors',
      discovery: 'scratch/.agents/skills -> P/.agents/skills',
      inactive: ['root-AGENTS', 'marketplace', 'Claude-hooks', 'other-harness-registration'],
      additionalSources: 'deny-or-separate-audited-required-system-allowlist',
    },
    officialMarketplaceEquivalent: false,
    modelRequestsEnabled: false,
    isolationCertificate: null,
    runtimeStatus: 'UNVERIFIED',
  });
  const recipe = {
    tool: 'crew-audited-official-native-skills',
    version: '1',
    options: ['full-upstream-tree', '15-internal-relative-links'],
    layoutSchema: 'superpowers-codex-native-skills-v1',
    policySha256: hash(policy),
    officialEntrypoints: NATIVE_SKILLS.map((name) => `skills/${name}/SKILL.md`),
  };
  const { officialEntrypoints: _e, ...derivation } = recipe;
  const base = {
    runtime: 'codex' as const,
    sourceTreeSha256: source.sourceTreeSha256,
    manifestSha256: manifestHash(manifest(nativeFiles(files))),
    derivation,
  };
  return {
    sourceTreeSha256: source.sourceTreeSha256,
    runtime: 'codex',
    recipe,
    mappings: [],
    policy,
    native: 'superpowers-codex-native-skills-v1',
    expected: { ...base, treeSha256: projectionTreeHash(base) },
  };
}
