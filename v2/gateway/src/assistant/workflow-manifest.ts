import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, hash } from '../journal/atomic-records.ts';
import {
  type ManifestEntry,
  type ProjectionPin,
  type SourcePin,
  validateProjectionPin,
  validateSourcePin,
} from '../workflows/pins.ts';
import type { WorkflowRegistry } from '../workflows/registry.ts';
import { manifestHash } from '../workflows/stage.ts';

export type WorkflowDefinition = {
  sha256: string;
  skills: { path: string; sha256: string }[];
};

const skillPath = /^skills\/[a-z0-9][a-z0-9-]*\/SKILL\.md$/;

async function readPinnedSkill(root: string, entry: ManifestEntry): Promise<void> {
  const parts = entry.path.split('/');
  for (let index = 1; index < parts.length; index++) {
    const parent = await lstat(join(root, ...parts.slice(0, index)));
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('WORKFLOW_SKILL_MISMATCH');
  }
  const file = await open(
    join(root, entry.path),
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || hash(await file.readFile()) !== entry.sha256)
      throw new Error('WORKFLOW_SKILL_MISMATCH');
  } finally {
    await file.close();
  }
}

export function createWorkflowManifest(registry: Pick<WorkflowRegistry, 'resolve'>) {
  return {
    async loadDefinition(source: SourcePin, projection: ProjectionPin): Promise<WorkflowDefinition> {
      const pinnedSource = structuredClone(source);
      const pinnedProjection = structuredClone(projection);
      validateSourcePin(pinnedSource);
      if (pinnedSource.sourceTreeSha256 !== pinnedProjection.sourceTreeSha256)
        throw new Error('SOURCE_PROJECTION_MISMATCH');
      validateProjectionPin(pinnedProjection);
      if (pinnedSource.name === 'bmad') throw new Error('RENDER_ARTIFACT_REQUIRED');
      if (pinnedSource.name !== 'superpowers') throw new Error('WORKFLOW_DEFINITION_UNAVAILABLE');

      const resolved = await registry.resolve(pinnedSource, pinnedProjection);
      const sourceEntries = new Map(resolved.manifest.source.map((entry) => [entry.path, entry]));
      const projectionEntries = new Map(resolved.manifest.projection.map((entry) => [entry.path, entry]));
      const skills = [...sourceEntries.values()]
        .filter((entry) => skillPath.test(entry.path))
        .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))
        .map((entry) => ({ path: entry.path, sha256: entry.sha256 }));
      if (skills.length === 0) throw new Error('WORKFLOW_SKILL_MISMATCH');
      for (const skill of skills) {
        const fromSource = sourceEntries.get(skill.path);
        const fromProjection = projectionEntries.get(skill.path);
        if (
          !fromSource ||
          !fromProjection ||
          fromSource.type !== 'file' ||
          fromProjection.type !== 'file' ||
          fromSource.sha256 !== fromProjection.sha256
        )
          throw new Error('WORKFLOW_SKILL_MISMATCH');
        await readPinnedSkill(resolved.sourceRoot, fromSource);
        await readPinnedSkill(resolved.projectionRoot, fromProjection);
      }
      if (
        manifestHash(resolved.manifest.source) !== pinnedSource.sourceManifestSha256 ||
        manifestHash(resolved.manifest.projection) !== pinnedProjection.manifestSha256
      )
        throw new Error('WORKFLOW_MANIFEST_MISMATCH');
      return {
        sha256: hash(canonicalJson({ source: pinnedSource, projection: pinnedProjection, skills })),
        skills,
      };
    },
  };
}
