import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  type CapturedRenderExpectation,
  createBmadArtifactInspector,
  type RenderArtifactByteSnapshot,
} from '../src/assistant/render-artifacts.ts';
import { createWorkflowManifest } from '../src/assistant/workflow-manifest.ts';
import type { ProjectionPin, SourcePin } from '../src/workflows/pins.ts';

const utf8 = (value: string) => Buffer.from(value, 'utf8');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const projectRoot = '/tmp/crew-d1-project';
const rootHash = 'e31ee119c324'; // Independently checked with shasum -a 256.
const generationHash = 'db428e8cadb37b64897b'; // Python-canonical identity, independently hashed.
const generationRoot = `${projectRoot}/_bmad/render/bmad-build/crew-d1-project-${rootHash}/${generationHash}`;

const digests = {
  renderer: '6f768a074387eb792a47480309b141ddea029e7d40e15d57065fa55efcf251f4',
  configUtils: '4afc0875345081259938d336958d2204b5cc208fdc444892591db75f1c3f462e',
  skill: '3f5ea125f393906ca652e8d46e2d23af3c9658349401a3f5cf72e9ce267ef695',
  workflow: '34e4fd548706409f320dd4e33d551d13c4c193520e7d13059f2eda806d32f6db',
  step: '97830ca24a8655658903c814e28e821322a7d054c8ef3ec2ab51a1c96e90ae55',
  customize: '0b95c3bfc689fed34a631472c5d97699dc916e1294cea992c937120f2be09f4e',
  config: '4332099922e2f11616116e6331b4249a96591cefaab80d7db912e72c41507b05',
  generated: '5dae3af7c44d6c03e5cb46e18d3d8b6e2c76f7caa2cfae41600cdc316c6719b3',
} as const;

const source: SourcePin = {
  name: 'bmad',
  version: '6.12.0',
  sourceRevision: '05bfbd46d00766ec88eb9b42e76be2c575d64d7b',
  sourceUrl: 'https://registry.npmjs.org/bmad-method/-/bmad-method-6.12.0.tgz',
  payloadSha256: 'ac05c93f0b3c4256bb4072e6e1ff181eaad6cc0a64a27a63893bfb2b0b64aed2',
  packageIntegrity:
    'sha512-gbbHo32TxCPwo4Yy70kqykFRwN5UdYqfnDKTsKAsF9m5qtLeoiCgEawj/LuzLBHLrYA0WTOyL/XWtXpgyDonMQ==',
  sourceManifestSha256: 'bf966209b9abf05b2585a1225f6c176d1aaa9f0262248282adc5bad6b78bef68',
  sourceTreeSha256: '45227836f9983671126b31255cab949aeb61611a959d1042f7a2ca679f8f9317',
};
const projection: ProjectionPin = {
  runtime: 'claude',
  sourceTreeSha256: source.sourceTreeSha256,
  manifestSha256: 'cc532075e2a4af3f189b359188b534a71cdb2f38912333135b8530d0fc1d1567',
  derivation: {
    tool: 'bmad-official-package-local-installer',
    version: '6.12.0',
    options: ['frozen-dependencies', 'bmm', 'claude-code', 'no-shims', 'generated-metadata-v1'],
    layoutSchema: 'bmad-claude-v1',
    policySha256: 'a0ac56ece4b964da4e5481cd16f75dfb74d05425ef0b5c33bfb176e82926bd26',
  },
  treeSha256: '3d67e8d6fada5cd20e41922c3cf761ce73e63a61691f1e536579badae1aed54a',
};

type Fixture = {
  expected: CapturedRenderExpectation;
  snapshot: RenderArtifactByteSnapshot;
  manifest: Record<string, unknown>;
};

// Synthetic artifact bytes exercise inspection math; no renderer is run by this fixture.
function fixture(): Fixture {
  const projectedFiles = {
    '_bmad/scripts/render_skill.py': utf8('renderer-v1\n'),
    '_bmad/scripts/config_utils.py': utf8('config-utils-v1\n'),
    '.claude/skills/bmad-build/SKILL.md': utf8('Invoke render\n'),
    '.claude/skills/bmad-build/workflow.md': utf8('Start\n'),
    '.claude/skills/bmad-build/step-01.md': utf8('Next\n'),
    '.claude/skills/bmad-build/customize.toml': utf8('title = "Build"\n'),
  };
  const layers = {
    '_bmad/config.toml': digests.config,
    '_bmad/config.user.toml': null,
    '_bmad/custom/config.toml': null,
    '_bmad/custom/config.user.toml': null,
    '_bmad/custom/bmad-build.toml': null,
    '_bmad/custom/bmad-build.user.toml': null,
    '.claude/skills/bmad-build/customize.toml': digests.customize,
  };
  const layerFiles = {
    '_bmad/config.toml': utf8('project_name = "Demo"\n'),
    '_bmad/config.user.toml': null,
    '_bmad/custom/config.toml': null,
    '_bmad/custom/config.user.toml': null,
    '_bmad/custom/bmad-build.toml': null,
    '_bmad/custom/bmad-build.user.toml': null,
    '.claude/skills/bmad-build/customize.toml': utf8('title = "Build"\n'),
  };
  const inputs = {
    project_root: projectRoot,
    renderer_sha256: digests.renderer,
    resolved_values: {},
    source_sha256: { 'step-01.md': digests.step, 'workflow.md': digests.workflow },
  };
  const manifest = {
    schema_version: 1,
    skill: 'bmad-build',
    project_root: projectRoot,
    project_slug: 'crew-d1-project',
    root_hash: rootHash,
    generation_hash: generationHash,
    inputs,
    outputs: { 'step-01.md': digests.step, 'workflow.md': digests.generated },
  };
  return {
    expected: {
      projectRoot,
      generationRoot,
      source: structuredClone(source),
      projection: structuredClone(projection),
      selectedProjectionSha256: {
        '_bmad/scripts/render_skill.py': digests.renderer,
        '_bmad/scripts/config_utils.py': digests.configUtils,
        '.claude/skills/bmad-build/SKILL.md': digests.skill,
        '.claude/skills/bmad-build/workflow.md': digests.workflow,
        '.claude/skills/bmad-build/step-01.md': digests.step,
        '.claude/skills/bmad-build/customize.toml': digests.customize,
      },
      layers,
    },
    snapshot: {
      generationPath: generationRoot,
      projectedFiles,
      layerFiles,
      manifestBytes: utf8(JSON.stringify(manifest)),
      outputBytes: { 'step-01.md': utf8('Next\n'), 'workflow.md': utf8('Generated workflow\n') },
    },
    manifest,
  };
}

function replaceManifest(f: Fixture): void {
  f.snapshot.manifestBytes = utf8(JSON.stringify(f.manifest));
}

test('render artifact inspection measures a supplied schema-1 artifact but returns no authority', () => {
  const f = fixture();
  const measured = createBmadArtifactInspector(f.expected).inspect(f.snapshot);
  assert.deepEqual(measured, {
    kind: 'artifact-inspection',
    manifestSha256: sha256(f.snapshot.manifestBytes),
    sourceSha256: { 'step-01.md': digests.step, 'workflow.md': digests.workflow },
    outputSha256: { 'step-01.md': digests.step, 'workflow.md': digests.generated },
    layerSha256: f.expected.layers,
  });
  assert.equal('verified' in measured, false);
  assert.equal('receipt' in measured, false);
});

test('render artifact inspection retains captured expectation after nested caller mutation', () => {
  const f = fixture();
  const inspector = createBmadArtifactInspector(f.expected);
  f.expected.projection.derivation.options[0] = 'changed-after-capture';
  (f.expected.selectedProjectionSha256 as Record<string, string>)['_bmad/scripts/render_skill.py'] =
    '0'.repeat(64);
  (f.expected.layers as Record<string, string | null>)['_bmad/config.toml'] = '0'.repeat(64);
  assert.equal(inspector.inspect(f.snapshot).kind, 'artifact-inspection');
});

test('render artifact inspection keeps the measured result independent of later byte mutation', () => {
  const f = fixture();
  const measured = createBmadArtifactInspector(f.expected).inspect(f.snapshot);
  f.snapshot.manifestBytes.fill(0);
  f.snapshot.outputBytes['workflow.md']?.fill(0);
  assert.equal(measured.manifestSha256, sha256(utf8(JSON.stringify(f.manifest))));
  assert.equal(measured.outputSha256['workflow.md'], digests.generated);
});

test('render artifact inspection rejects raw optional-layer drift even with equal resolved values', () => {
  for (const change of ['appeared', 'changed'] as const) {
    const f = fixture();
    if (change === 'appeared')
      (f.snapshot.layerFiles as Record<string, Uint8Array | null>)['_bmad/config.user.toml'] =
        utf8('unused = "x"\n');
    else {
      (f.expected.layers as Record<string, string | null>)['_bmad/config.user.toml'] = sha256(
        utf8('unused = "x"\n'),
      );
      (f.snapshot.layerFiles as Record<string, Uint8Array | null>)['_bmad/config.user.toml'] =
        utf8('unused = "y"\n');
    }
    assert.throws(
      () => createBmadArtifactInspector(f.expected).inspect(f.snapshot),
      /RENDER_ARTIFACT_MISMATCH/,
    );
  }
});

test('render artifact inspection rejects a missing required layer or undeclared layer key', () => {
  const missing = fixture();
  delete (missing.snapshot.layerFiles as Record<string, Uint8Array | null>)['_bmad/config.toml'];
  assert.throws(
    () => createBmadArtifactInspector(missing.expected).inspect(missing.snapshot),
    /RENDER_ARTIFACT_MISMATCH/,
  );

  const extra = fixture();
  (extra.snapshot.layerFiles as Record<string, Uint8Array | null>)['_bmad/custom/other.toml'] = utf8('x\n');
  assert.throws(
    () => createBmadArtifactInspector(extra.expected).inspect(extra.snapshot),
    /RENDER_ARTIFACT_MISMATCH/,
  );
});

test('render artifact inspection rejects source, renderer and output byte changes', () => {
  const tamper = [
    (f: Fixture) => {
      (f.snapshot.projectedFiles as Record<string, Uint8Array>)['.claude/skills/bmad-build/workflow.md'] =
        utf8('Changed\n');
    },
    (f: Fixture) => {
      (f.snapshot.projectedFiles as Record<string, Uint8Array>)['_bmad/scripts/render_skill.py'] =
        utf8('wrong renderer\n');
    },
    (f: Fixture) => {
      (f.snapshot.outputBytes as Record<string, Uint8Array>)['workflow.md'] = utf8('wrong output\n');
    },
  ];
  for (const mutate of tamper) {
    const f = fixture();
    mutate(f);
    assert.throws(
      () => createBmadArtifactInspector(f.expected).inspect(f.snapshot),
      /RENDER_ARTIFACT_MISMATCH/,
    );
  }
});

test('render artifact inspection rejects false schema, path and generation claims', () => {
  const mutations = [
    (f: Fixture) => {
      f.manifest.schema_version = 2;
    },
    (f: Fixture) => {
      f.manifest.root_hash = '0'.repeat(12);
    },
    (f: Fixture) => {
      f.manifest.generation_hash = '0'.repeat(20);
    },
    (f: Fixture) => {
      f.manifest.project_slug = 'other-project';
    },
    (f: Fixture) => {
      f.manifest.project_root = '/tmp/other-project';
    },
    (f: Fixture) => {
      (f.manifest.inputs as Record<string, unknown>).project_root = '/tmp/other-project';
    },
    (f: Fixture) => {
      f.manifest.unexpected = true;
    },
    (f: Fixture) => {
      f.snapshot.generationPath = '/tmp/other-generation';
    },
    (f: Fixture) => {
      f.manifest.outputs = { '../escape.md': digests.generated, 'step-01.md': digests.step };
    },
    (f: Fixture) => {
      f.manifest.outputs = { 'step-01.md': digests.step };
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    replaceManifest(f);
    assert.throws(
      () => createBmadArtifactInspector(f.expected).inspect(f.snapshot),
      /RENDER_ARTIFACT_MISMATCH/,
    );
  }
});

test('render artifact inspection bounds layer bytes as well as manifest and output bytes', () => {
  const f = fixture();
  (f.snapshot.layerFiles as Record<string, Uint8Array | null>)['_bmad/config.toml'] = new Uint8Array(
    32 * 1024 * 1024 + 1,
  );
  assert.throws(
    () => createBmadArtifactInspector(f.expected).inspect(f.snapshot),
    /RENDER_ARTIFACT_TOO_LARGE/,
  );
});

test('render artifact inspection bounds metadata key counts before copying byte maps', () => {
  const f = fixture();
  const outputs = f.snapshot.outputBytes as Record<string, Uint8Array>;
  for (let index = 0; index < 4_096; index++) outputs[`extra-${index}.md`] = utf8('x');
  assert.throws(
    () => createBmadArtifactInspector(f.expected).inspect(f.snapshot),
    /RENDER_ARTIFACT_TOO_LARGE/,
  );
});

test('render artifact inspection matches Python Unicode and control-character generation hashing', () => {
  const f = fixture();
  const exactHash = '80aa56fd1668810c187a'; // shasum of Python-format canonical identity with Café\\nX.
  const exactRoot = `${projectRoot}/_bmad/render/bmad-build/crew-d1-project-${rootHash}/${exactHash}`;
  (f.manifest.inputs as Record<string, unknown>).resolved_values = { 'config.project_name': 'Café\nX' };
  f.manifest.generation_hash = exactHash;
  f.expected.generationRoot = exactRoot;
  f.snapshot.generationPath = exactRoot;
  replaceManifest(f);
  assert.equal(createBmadArtifactInspector(f.expected).inspect(f.snapshot).kind, 'artifact-inspection');
});

test('render artifact inspection rejects an undeclared source-authored snapshot target', () => {
  const f = fixture();
  const changedHash = '5bbd9a6ddfe4fbd7fcf9b0e4db80ad38107599d4e8781c507a8ab1b7aa1df790';
  const changedGeneration = '1f79af652de671f3c06';
  (f.expected.selectedProjectionSha256 as Record<string, string>)['.claude/skills/bmad-build/workflow.md'] =
    changedHash;
  (f.snapshot.projectedFiles as Record<string, Uint8Array>)['.claude/skills/bmad-build/workflow.md'] = utf8(
    'See [[bmad-snapshot:missing.md]]\n',
  );
  ((f.manifest.inputs as Record<string, unknown>).source_sha256 as Record<string, string>)['workflow.md'] =
    changedHash;
  f.manifest.generation_hash = changedGeneration;
  f.expected.generationRoot = `${projectRoot}/_bmad/render/bmad-build/crew-d1-project-${rootHash}/${changedGeneration}`;
  f.snapshot.generationPath = f.expected.generationRoot;
  replaceManifest(f);
  assert.throws(
    () => createBmadArtifactInspector(f.expected).inspect(f.snapshot),
    /RENDER_ARTIFACT_MISMATCH/,
  );
});

test('render artifact inspection refuses unsupported numeric resolved values', () => {
  const f = fixture();
  const inputs = f.manifest.inputs as Record<string, unknown>;
  inputs.resolved_values = { 'config.project_name': 1.5 };
  replaceManifest(f);
  assert.throws(
    () => createBmadArtifactInspector(f.expected).inspect(f.snapshot),
    /RENDER_ARTIFACT_MISMATCH/,
  );
});

test('render artifact inspection remains separate from the denied BMAD adapter', async () => {
  const adapter = createWorkflowManifest({
    resolve: async () => {
      throw new Error('resolver must not run');
    },
  });
  await assert.rejects(adapter.loadDefinition(source, projection), /RENDER_ARTIFACT_REQUIRED/);
});
