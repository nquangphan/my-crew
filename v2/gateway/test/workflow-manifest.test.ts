import assert from 'node:assert/strict';
import childProcess, { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { mock } from 'node:test';
import { createBmadArtifactInspector } from '../src/assistant/render-artifacts.ts';
import { createWorkflowManifest, customizationContext } from '../src/assistant/workflow-manifest.ts';
import { canonicalJson, hash } from '../src/journal/atomic-records.ts';
import { type ProjectionPin, projectionTreeHash, type SourcePin } from '../src/workflows/pins.ts';
import type { WorkflowRegistry } from '../src/workflows/registry.ts';
import {
  manifest,
  manifestHash,
  parseArchive,
  type TreeFile,
  validateFiles,
  writeTree,
} from '../src/workflows/stage.ts';

const fixtures = new URL('./fixtures/', import.meta.url);

async function officialFixtures() {
  const audits = JSON.parse(await readFile(new URL('workflows/official-audits.json', fixtures), 'utf8'));
  const builds = JSON.parse(
    await readFile(new URL('workflow-builder/real-projections.json', fixtures), 'utf8'),
  );
  return { audits, builds };
}

async function withOfficialSuperpowers(
  run: (
    resolver: Pick<WorkflowRegistry, 'resolve'>,
    source: SourcePin,
    projection: ProjectionPin,
  ) => Promise<void>,
) {
  const { audits } = await officialFixtures();
  const source = audits.superpowers.source.pin as SourcePin;
  const projectionAudit = audits.superpowers.projections.claude;
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-workflow-manifest-')));
  try {
    const archive = await readFile(new URL('workflows/superpowers-6.4.2.tgz', fixtures));
    const files = await parseArchive(archive, audits.superpowers.source.executables);
    const projected = validateFiles(
      projectionAudit.mappings.flatMap((mapping: { from: string; to: string }) =>
        files
          .filter((file) => file.path === mapping.from || file.path.startsWith(`${mapping.from}/`))
          .map((file) => ({
            ...file,
            path: `${mapping.to}${file.path.slice(mapping.from.length)}`,
            body: Buffer.from(file.body),
          })),
      ),
    );
    assert.equal(manifestHash(manifest(files)), source.sourceManifestSha256);
    assert.equal(manifestHash(manifest(projected)), projectionAudit.expected.manifestSha256);
    const sourceRoot = join(root, 'source');
    const projectionRoot = join(root, 'projection');
    await writeTree(sourceRoot, files);
    await writeTree(projectionRoot, projected);
    // Unit-only resolver carrying actual pinned archive bytes and audited projection layout.
    const resolver: Pick<WorkflowRegistry, 'resolve'> = {
      resolve: async () => ({
        sourceRoot,
        projectionRoot,
        manifest: { source: manifest(files), projection: manifest(projected) },
      }),
    };
    await run(resolver, source, projectionAudit.expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

type BmadFixture = {
  official: { path: string; from: string; mode: number; sha256: string }[];
  generated: { path: string; body: string; sha256: string }[];
  expectedSkills: string[];
};

const bmadSkillRoot = '.claude/skills/bmad-build/';
const layerOrder = [
  '_bmad/config.toml',
  '_bmad/config.user.toml',
  '_bmad/custom/config.toml',
  '_bmad/custom/config.user.toml',
  '_bmad/custom/bmad-build.toml',
  '_bmad/custom/bmad-build.user.toml',
  '.claude/skills/bmad-build/customize.toml',
] as const;

async function bmadProjectionFiles() {
  const { audits, builds } = await officialFixtures();
  const fixture: BmadFixture = JSON.parse(
    await readFile(new URL('workflow-definitions/bmad-claude-projection.json', fixtures), 'utf8'),
  );
  const archive = await readFile(new URL('workflows/bmad-6.12.0.tgz', fixtures));
  const sourceFiles = await parseArchive(archive, audits.bmad.source.executables);
  const byPath = new Map(sourceFiles.map((file) => [file.path, file]));
  const projected: TreeFile[] = [
    ...fixture.official.map((entry) => {
      const file = byPath.get(entry.from);
      assert(file && file.type === 'file', `missing official ${entry.from}`);
      assert.equal(hash(file.body), entry.sha256, `official bytes drifted for ${entry.path}`);
      return {
        path: entry.path,
        type: 'file' as const,
        mode: entry.mode === 0o755 ? (0o755 as const) : (0o644 as const),
        body: Buffer.from(file.body),
      };
    }),
    ...fixture.generated.map((entry) => {
      assert.equal(hash(entry.body), entry.sha256);
      return { path: entry.path, type: 'file' as const, mode: 0o644 as const, body: Buffer.from(entry.body) };
    }),
  ];
  return {
    source: audits.bmad.source.pin as SourcePin,
    sourceManifest: manifest(sourceFiles),
    derivation: builds.bmad.claude.expected.derivation as ProjectionPin['derivation'],
    projected,
    fixture,
  };
}

async function withBmadProjection(
  edit: (files: TreeFile[]) => TreeFile[],
  run: (
    resolver: Pick<WorkflowRegistry, 'resolve'>,
    source: SourcePin,
    projection: ProjectionPin,
    context: { fixture: BmadFixture; projectionRoot: string; files: TreeFile[] },
  ) => Promise<void>,
) {
  const { source, sourceManifest, derivation, projected, fixture } = await bmadProjectionFiles();
  assert.equal(manifestHash(sourceManifest), source.sourceManifestSha256);
  const files = validateFiles(edit(projected));
  const projectionManifest = manifest(files);
  const base = {
    runtime: 'claude' as const,
    sourceTreeSha256: source.sourceTreeSha256,
    manifestSha256: manifestHash(projectionManifest),
    derivation,
  };
  // Unit-only projection identity recomputed over a pinned subset of the audited BMAD layout:
  // official bytes from the pinned archive plus synthetic installer-generated config layers.
  const projection: ProjectionPin = { ...base, treeSha256: projectionTreeHash(base) };
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-workflow-definition-')));
  try {
    const projectionRoot = join(root, 'projection');
    await writeTree(projectionRoot, files);
    const resolver: Pick<WorkflowRegistry, 'resolve'> = {
      resolve: async () => ({
        sourceRoot: join(root, 'source-not-materialized'),
        projectionRoot,
        manifest: { source: sourceManifest, projection: projectionManifest },
      }),
    };
    await run(resolver, source, projection, { fixture, projectionRoot, files });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const without =
  (...paths: string[]) =>
  (files: TreeFile[]) =>
    files.filter((file) => !paths.includes(file.path));

function reorderedKeys<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, item]) => [
        key,
        item && typeof item === 'object' && !Array.isArray(item)
          ? reorderedKeys(item as Record<string, unknown>)
          : item,
      ]),
  ) as T;
}

test('workflow manifest binds Superpowers skills to official source and selected projection bytes', async () => {
  await withOfficialSuperpowers(async (resolver, source, projection) => {
    const adapter = createWorkflowManifest(resolver);
    const first = await adapter.loadDefinition(source, projection);
    const replay = await adapter.loadDefinition(source, projection);

    assert.match(first.sha256, /^[0-9a-f]{64}$/);
    assert.equal(first.sha256, replay.sha256);
    assert.deepEqual(first, replay);
    assert.equal(first.render, undefined);
    assert.deepEqual(Object.keys(first).sort(), ['customizationSha256', 'sha256', 'skills']);
    assert.equal(first.customizationSha256, customizationContext(source, projection, {}).sha256);
    assert.equal(first.skills.length, 15);
    assert.deepEqual(first.skills[0], {
      path: 'skills/brainstorming/SKILL.md',
      sha256: 'a32d2255354775aa124855aa7100cf276bea096fff4ebb3a0edf57be216e6c72',
    });
    assert(
      first.skills.some(
        (skill) =>
          skill.path === 'skills/systematic-debugging/SKILL.md' &&
          skill.sha256 === '808fc5717aa88ad65efff312b11c186294d3e6ee301afb584e2f86599b137787',
      ),
    );
  });
});

test('workflow manifest rejects a projected skill hash that differs from its pinned source', async () => {
  await withOfficialSuperpowers(async (resolver, source, projection) => {
    const resolved = await resolver.resolve(source, projection);
    // Unit-only compromised producer: a real WorkflowRegistry would reject a drifted manifest.
    const compromised = {
      resolve: async () => ({
        ...resolved,
        manifest: {
          ...resolved.manifest,
          projection: resolved.manifest.projection.map((entry) =>
            entry.path === 'skills/brainstorming/SKILL.md' ? { ...entry, sha256: '0'.repeat(64) } : entry,
          ),
        },
      }),
    };
    await assert.rejects(
      createWorkflowManifest(compromised).loadDefinition(source, projection),
      /WORKFLOW_SKILL_MISMATCH/,
    );
  });
});

test('workflow manifest re-reads exact skill bytes instead of trusting manifest hash claims', async () => {
  await withOfficialSuperpowers(async (resolver, source, projection) => {
    const resolved = await resolver.resolve(source, projection);
    await writeFile(join(resolved.sourceRoot, 'skills/brainstorming/SKILL.md'), 'tampered');
    await assert.rejects(
      createWorkflowManifest(resolver).loadDefinition(source, projection),
      /WORKFLOW_SKILL_MISMATCH/,
    );
  });
});

test('workflow manifest rejects a projection bound to another source tree', async () => {
  await withOfficialSuperpowers(async (resolver, source, projection) => {
    const base = { ...projection, sourceTreeSha256: '0'.repeat(64) };
    const foreign = { ...base, treeSha256: projectionTreeHash(base) };
    await assert.rejects(
      createWorkflowManifest(resolver).loadDefinition(source, foreign),
      /SOURCE_PROJECTION_MISMATCH/,
    );
  });
});

test('workflow manifest keeps one validated snapshot across a deferred registry resolve', async () => {
  await withOfficialSuperpowers(async (resolver, source, projection) => {
    const originalSource = structuredClone(source);
    const originalProjection = structuredClone(projection);
    const baseline = await createWorkflowManifest(resolver).loadDefinition(
      originalSource,
      originalProjection,
    );
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const deferred: Pick<WorkflowRegistry, 'resolve'> = {
      resolve: async (inputSource, inputProjection) => {
        // The real registry snapshots both inputs before its first await.
        const capturedSource = structuredClone(inputSource);
        const capturedProjection = structuredClone(inputProjection);
        entered.resolve();
        await release.promise;
        return resolver.resolve(capturedSource, capturedProjection);
      },
    };
    const pending = createWorkflowManifest(deferred).loadDefinition(source, projection);
    await entered.promise;
    source.name = 'bmad';
    projection.runtime = 'api';
    projection.derivation.options.push('changed-after-validation');
    release.resolve();
    assert.deepEqual(await pending, baseline);
  });
});

test('workflow manifest rejects a FIFO skill drift within a bounded reader deadline', async (context) => {
  await withOfficialSuperpowers(async (resolver, source, projection) => {
    const resolved = await resolver.resolve(source, projection);
    context.diagnostic(`fifo scratch root=${join(resolved.sourceRoot, '..')}`);
    const target = join(resolved.sourceRoot, 'skills/brainstorming/SKILL.md');
    await rm(target);
    const fifo = spawnSync('/usr/bin/mkfifo', [target], { timeout: 3000, encoding: 'utf8' });
    context.diagnostic(`mkfifo pid=${fifo.pid} status=${fifo.status} signal=${fifo.signal ?? 'none'}`);
    assert.equal(fifo.status, 0, fifo.stderr || String(fifo.error));
    const fixturePath = join(resolved.sourceRoot, '..', 'fifo-case.json');
    await writeFile(fixturePath, JSON.stringify({ resolved, source, projection }));

    const script = `
      import { readFile } from 'node:fs/promises';
      import { createWorkflowManifest } from ${JSON.stringify(new URL('../src/assistant/workflow-manifest.ts', import.meta.url).href)};
      const { resolved, source, projection } = JSON.parse(await readFile(process.argv[1], 'utf8'));
      const registry = { resolve: async () => { process.stdout.write('RESOLVED\\n'); return resolved; } };
      try {
        await createWorkflowManifest(registry).loadDefinition(source, projection);
        process.stderr.write('UNEXPECTED_SUCCESS\\n');
        process.exitCode = 2;
      } catch (error) {
        process.stderr.write(String(error?.message ?? error) + '\\n');
        process.exitCode = String(error?.message ?? error).includes('WORKFLOW_SKILL_MISMATCH') ? 0 : 3;
      }
    `;
    const child = spawn(
      process.execPath,
      ['--max-old-space-size=128', '--input-type=module', '--eval', script, fixturePath],
      {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { NODE_OPTIONS: '--max-old-space-size=128' },
      },
    );
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk.slice(0, 8192);
    });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk.slice(0, 8192);
    });
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolveChild, reject) => {
        const timer = setTimeout(() => {
          timedOut = true;
          if (child.pid) {
            try {
              process.kill(-child.pid, 'SIGKILL');
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ESRCH') reject(error);
            }
          }
        }, 3000);
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once('close', (code, signal) => {
          clearTimeout(timer);
          resolveChild({ code, signal });
        });
      },
    );
    context.diagnostic(
      `fifo child pid=${child.pid} pgid=${child.pid} reaped=close code=${result.code} signal=${result.signal ?? 'none'} timedOut=${timedOut}`,
    );
    context.diagnostic(`fifo child boundary=${stdout.trim()}`);
    assert.match(stdout, /RESOLVED/, `child did not reach the reader: ${stderr}`);
    assert.equal(timedOut, false, `reader blocked on FIFO; child reaped by watchdog (${result.signal})`);
    assert.equal(result.code, 0, stderr);
    assert.match(stderr, /WORKFLOW_SKILL_MISMATCH/);
  });
});

test('customization context binds the Superpowers digest to the projection tree, not key order', async () => {
  await withOfficialSuperpowers(async (_resolver, source, projection) => {
    const measured = customizationContext(source, projection, {});
    assert.deepEqual(measured.context, {
      schema: 'crew-v2:workflow-customization:1',
      workflow: 'superpowers',
      sourceTreeSha256: source.sourceTreeSha256,
      projectionTreeSha256: projection.treeSha256,
      layers: {},
    });
    assert.equal(measured.sha256, hash(canonicalJson(measured.context)));
    assert.equal(
      customizationContext(reorderedKeys(source), reorderedKeys(projection), {}).sha256,
      measured.sha256,
    );

    const changedBase = { ...projection, manifestSha256: '1'.repeat(64) };
    const changed = { ...changedBase, treeSha256: projectionTreeHash(changedBase) };
    assert.notEqual(customizationContext(source, changed, {}).sha256, measured.sha256);
    assert.throws(
      () => customizationContext(source, projection, { '_bmad/config.toml': '0'.repeat(64) }),
      /INVALID_CUSTOMIZATION_CONTEXT/,
    );
  });
});

test('workflow definition resolves BMAD to a two-tier render expectation with seven measured layers', async () => {
  await withBmadProjection(
    (files) => files,
    async (resolver, source, projection, { fixture, files }) => {
      const definition = await createWorkflowManifest(resolver).loadDefinition(source, projection);
      const bytes = new Map(files.map((file) => [file.path, hash(file.body)]));
      const expectedLayers = Object.fromEntries(layerOrder.map((path) => [path, bytes.get(path) ?? null]));
      assert.deepEqual(expectedLayers, {
        '_bmad/config.toml': fixture.generated[0].sha256,
        '_bmad/config.user.toml': fixture.generated[1].sha256,
        '_bmad/custom/config.toml': fixture.generated[3].sha256,
        '_bmad/custom/config.user.toml': fixture.generated[4].sha256,
        '_bmad/custom/bmad-build.toml': null,
        '_bmad/custom/bmad-build.user.toml': null,
        '.claude/skills/bmad-build/customize.toml':
          '0ee9b033a40640420d1dc3411de7428146d00bf8c1409c9a9cfe6c1743cd53b9',
      });
      assert(definition.render);
      assert.deepEqual(Object.keys(definition.render).sort(), [
        'layers',
        'projection',
        'selectedProjectionSha256',
        'source',
      ]);
      assert.deepEqual(definition.render.source, source);
      assert.deepEqual(definition.render.projection, projection);
      assert.deepEqual(definition.render.layers, expectedLayers);
      assert.deepEqual(Object.keys(definition.render.layers).sort(), [...layerOrder].sort());
      const selected = Object.keys(definition.render.selectedProjectionSha256).sort();
      assert.deepEqual(
        selected,
        [
          '_bmad/scripts/config_utils.py',
          '_bmad/scripts/render_skill.py',
          `${bmadSkillRoot}SKILL.md`,
          `${bmadSkillRoot}customize.toml`,
          ...fixture.expectedSkills,
        ].sort(),
      );
      for (const path of selected)
        assert.equal(definition.render.selectedProjectionSha256[path], bytes.get(path));
      assert.equal(
        definition.customizationSha256,
        customizationContext(source, projection, expectedLayers).sha256,
      );
      assert.equal(
        customizationContext(source, projection, reorderedKeys(expectedLayers)).sha256,
        definition.customizationSha256,
      );
      // The definition is exactly the D1 expectation minus host-bound roots.
      const projectRoot = '/tmp/crew-d2-project';
      assert.doesNotThrow(() =>
        createBmadArtifactInspector({
          ...structuredClone(definition.render),
          projectRoot,
          generationRoot: `${projectRoot}/_bmad/render/bmad-build/crew-d2-project-000000000000/${'0'.repeat(20)}`,
        } as Parameters<typeof createBmadArtifactInspector>[0]),
      );
    },
  );
  for (const required of ['_bmad/config.toml', `${bmadSkillRoot}customize.toml`]) {
    await withBmadProjection(without(required), async (resolver, source, projection) => {
      await assert.rejects(
        createWorkflowManifest(resolver).loadDefinition(source, projection),
        /WORKFLOW_SKILL_MISMATCH/,
        required,
      );
    });
  }
  await withBmadProjection(
    (files) => [
      ...files,
      {
        path: '_bmad/custom/bmad-build.toml',
        type: 'symlink',
        mode: null,
        body: Buffer.alloc(0),
        target: 'config.toml',
      },
    ],
    async (resolver, source, projection) => {
      await assert.rejects(
        createWorkflowManifest(resolver).loadDefinition(source, projection),
        /WORKFLOW_SKILL_MISMATCH/,
      );
    },
  );
});

test('workflow definition re-reads BMAD layer bytes instead of trusting manifest claims', async () => {
  await withBmadProjection(
    (files) => files,
    async (resolver, source, projection, { projectionRoot }) => {
      await writeFile(join(projectionRoot, '_bmad/custom/config.toml'), 'tampered = true\n');
      await assert.rejects(
        createWorkflowManifest(resolver).loadDefinition(source, projection),
        /WORKFLOW_SKILL_MISMATCH/,
      );
    },
  );
});

test('workflow definition digest changes when an optional BMAD layer appears with equal skill tokens', async () => {
  let baseline: Awaited<ReturnType<ReturnType<typeof createWorkflowManifest>['loadDefinition']>> | undefined;
  await withBmadProjection(
    (files) => files,
    async (resolver, source, projection) => {
      baseline = await createWorkflowManifest(resolver).loadDefinition(source, projection);
    },
  );
  const overrides = '# Synthetic optional layer without token-changing values.\n';
  await withBmadProjection(
    (files) => [
      ...files,
      { path: '_bmad/custom/bmad-build.toml', type: 'file', mode: 0o644, body: Buffer.from(overrides) },
    ],
    async (resolver, source, projection) => {
      assert(baseline?.render);
      const withLayer = await createWorkflowManifest(resolver).loadDefinition(source, projection);
      assert(withLayer.render);
      assert.deepEqual(withLayer.skills, baseline.skills);
      assert.deepEqual(withLayer.render.selectedProjectionSha256, baseline.render.selectedProjectionSha256);
      assert.deepEqual(withLayer.render.layers, {
        ...baseline.render.layers,
        '_bmad/custom/bmad-build.toml': hash(overrides),
      });
      assert.notEqual(withLayer.customizationSha256, baseline.customizationSha256);
      assert.notEqual(withLayer.sha256, baseline.sha256);
    },
  );
});

test('workflow definition selects exactly the bmad-build markdown skills except SKILL.md', async () => {
  await withBmadProjection(
    (files) => files,
    async (resolver, source, projection, { fixture, files }) => {
      const definition = await createWorkflowManifest(resolver).loadDefinition(source, projection);
      const bytes = new Map(files.map((file) => [file.path, hash(file.body)]));
      assert.deepEqual(
        definition.skills,
        fixture.expectedSkills.map((path) => ({ path, sha256: bytes.get(path) })),
      );
      assert(definition.skills.some((skill) => skill.path === `${bmadSkillRoot}workflow.md`));
      assert(definition.skills.every((skill) => !skill.path.endsWith('/SKILL.md')));
      assert(definition.skills.every((skill) => skill.path.startsWith(bmadSkillRoot)));
      assert.equal(definition.skills.length, 14);
    },
  );
  for (const required of [`${bmadSkillRoot}workflow.md`, `${bmadSkillRoot}SKILL.md`]) {
    await withBmadProjection(without(required), async (resolver, source, projection) => {
      await assert.rejects(
        createWorkflowManifest(resolver).loadDefinition(source, projection),
        /WORKFLOW_SKILL_MISMATCH/,
        required,
      );
    });
  }
});

test('workflow definition rejects a BMAD projection bound to another source tree', async () => {
  await withBmadProjection(
    (files) => files,
    async (_resolver, source, projection) => {
      const base = { ...projection, sourceTreeSha256: '0'.repeat(64) };
      const foreign = { ...base, treeSha256: projectionTreeHash(base) };
      const refusing = {
        resolve: async () => {
          throw new Error('resolver must not run');
        },
      };
      await assert.rejects(
        createWorkflowManifest(refusing).loadDefinition(source, foreign),
        /SOURCE_PROJECTION_MISMATCH/,
      );
    },
  );
});

test('workflow definition never spawns uv, the renderer or any child process', async () => {
  const text = await readFile(new URL('../src/assistant/workflow-manifest.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /child_process|createBmadArtifactInspector|OwnedOperations|\buv\b/);
  await withBmadProjection(
    (files) => files,
    async (resolver, source, projection) => {
      const names = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const;
      const spies = names.map((name) =>
        mock.method(childProcess, name, () => {
          throw new Error(`unexpected child_process.${name}`);
        }),
      );
      syncBuiltinESMExports();
      try {
        const definition = await createWorkflowManifest(resolver).loadDefinition(source, projection);
        assert(definition.render);
      } finally {
        mock.restoreAll();
        syncBuiltinESMExports();
      }
      for (const spy of spies) assert.equal(spy.mock.callCount(), 0);
    },
  );
});

test('workflow definition rejects a BMAD renderer script that is not a regular file with the stable code', async () => {
  await withBmadProjection(
    (files) => [
      ...files.filter((file) => file.path !== '_bmad/scripts/config_utils.py'),
      {
        path: '_bmad/scripts/config_utils.py',
        type: 'symlink',
        mode: null,
        body: Buffer.alloc(0),
        target: 'render_skill.py',
      },
    ],
    async (resolver, source, projection) => {
      await assert.rejects(
        createWorkflowManifest(resolver).loadDefinition(source, projection),
        /WORKFLOW_SKILL_MISMATCH/,
      );
    },
  );
});

test('workflow definition refuses a BMAD selection the render artifact inspector would reject', async () => {
  const extraSkills = (count: number) => (files: TreeFile[]) => [
    ...files,
    ...Array.from({ length: count }, (_, index) => ({
      path: `${bmadSkillRoot}extra/step-${String(index).padStart(3, '0')}.md`,
      type: 'file' as const,
      mode: 0o644 as const,
      body: Buffer.from(`Extra ${index}\n`),
    })),
  ];
  // 14 official skill sources + SKILL.md + customize.toml + 2 scripts = 18 selected paths.
  await withBmadProjection(extraSkills(128 - 18), async (resolver, source, projection) => {
    const definition = await createWorkflowManifest(resolver).loadDefinition(source, projection);
    assert(definition.render);
    assert.equal(Object.keys(definition.render.selectedProjectionSha256).length, 128);
  });
  await withBmadProjection(extraSkills(128 - 18 + 1), async (resolver, source, projection) => {
    await assert.rejects(
      createWorkflowManifest(resolver).loadDefinition(source, projection),
      /RENDER_ARTIFACT_TOO_LARGE/,
    );
  });
  // Every path component stays under the host name limit; the relative skill name is 513 characters.
  const longName = `${'a'.repeat(200)}/${'b'.repeat(200)}/${'c'.repeat(108)}.md`;
  assert.equal(longName.length, 513);
  await withBmadProjection(
    (files) => [
      ...files,
      { path: `${bmadSkillRoot}${longName}`, type: 'file', mode: 0o644, body: Buffer.from('Long\n') },
    ],
    async (resolver, source, projection) => {
      await assert.rejects(
        createWorkflowManifest(resolver).loadDefinition(source, projection),
        /RENDER_ARTIFACT_MISMATCH/,
      );
    },
  );
});
