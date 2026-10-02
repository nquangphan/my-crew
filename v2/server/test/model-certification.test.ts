import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { databaseFixture } from './support/db.ts';
import { nextConfig, prepareSelection, report } from './support/gateway.ts';
import { registerModelTestIssuer } from './support/model-certification.ts';
import { modelFixture } from './support/model-http.ts';

test('model certification production route never trusts host surface PASS or exposes test challenge issue', async () => {
  await databaseFixture(8)(async (db) => {
    const f = await modelFixture(db);
    try {
      assert.equal((await f.machine.post('/v2/test/model-certifications/challenges', {})).statusCode, 404);
      const production = await buildApp({
        db,
        publicOrigin: 'http://localhost:5182',
        secureCookies: false,
        sessionEncryptionKey: f.identity.key,
        now: () => new Date(),
      });
      try {
        const url = await production.listen({ host: '127.0.0.1', port: 0 });
        const absent = await fetch(`${url}/v2/test/model-certifications/challenges`, {
          method: 'POST',
          headers: { authorization: `Bearer ${f.token}`, 'content-type': 'application/json' },
          body: '{}',
        });
        assert.equal(absent.status, 404);
      } finally {
        await production.close();
      }
      const evidence = {
        challengeId: randomUUID(),
        attemptId: randomUUID(),
        fence: '1',
        processInstanceId: randomUUID(),
        context: {
          sourceTreeSha256: 'e'.repeat(64),
          projectionManifestSha256: 'f'.repeat(64),
          projectionTreeSha256: '1'.repeat(64),
          derivationSha256: '3'.repeat(64),
          binarySha256: '4'.repeat(64),
          policySha256: '5'.repeat(64),
          osVersion: 'macOS-test',
        },
        surfaceResults: [
          {
            surface: 'native-read',
            selectedWorked: true,
            unselectedDenied: true,
            traceSha256: '6'.repeat(64),
          },
        ],
        artifactIds: [],
        traceSha256: '7'.repeat(64),
      };
      const r = await f.machine.post('/v2/machine/models/certifications', evidence);
      assert.equal(r.statusCode, 200, r.text);
      assert.equal(r.json().status, 'UNVERIFIED');
      const [count] = await db`select count(*)::int as value from runtime_certification_receipts`;
      assert.equal(count?.value, 0);
      assert.equal(
        (await f.machine.post('/v2/machine/models/certifications', { ...evidence, pass: true })).statusCode,
        400,
      );
    } finally {
      await f.close();
    }
  });
});

import type { DispatchSelection, GatewayProjectionPolicy } from '../src/gateway/contracts.ts';
import type {
  CertificationEvidence,
  CertificationVerifier,
  ModelDispatchChoice,
  ProbeContext,
} from '../src/models/contracts.ts';
import { contextHash, hash } from '../src/models/helpers.ts';
import type { AuthorizeDispatch } from '../src/platform/contracts.ts';
import { ApiError } from '../src/platform/errors.ts';
import { projection, source } from './support/gateway.ts';

const ctx: ProbeContext = {
  sourceTreeSha256: 'e'.repeat(64),
  projectionManifestSha256: 'f'.repeat(64),
  projectionTreeSha256: '1'.repeat(64),
  derivationSha256: hash(projection('superpowers').derivation),
  binarySha256: '4'.repeat(64),
  policySha256: '5'.repeat(64),
  osVersion: 'macOS-test',
};
const surfaces = [
  'init',
  'invocation',
  'native-read',
  'bash-script',
  'mcp',
  'child',
  'absolute',
  'symlink',
  'hardlink',
  'network',
];
test('model challenge actual 008 attempt insert hook binds A and never authorizes B; trusted fake observer is isolated to test DB', async () => {
  await databaseFixture(8)(async (db) => {
    let authority: AuthorizeDispatch = async () => {
      throw new Error('private authority not ready');
    };
    const policy: GatewayProjectionPolicy = {
      authorize: async (tx, { attemptId, actor }) => {
        const [ch] =
          await tx`select * from model_certification_challenges where attempt_id=${attemptId} and machine_id=${actor.id}`;
        if (!ch || !['admitted', 'verified'].includes(String(ch.state)))
          throw new ApiError('TEST_ADMISSION_DENIED', 409, 'Fixture deny');
        const [c] = await tx`select payload from commands where id=${ch.admitted_command_id}`;
        if (!c) throw new Error('missing command');
        return (c.payload as { selection: DispatchSelection }).selection;
      },
    };
    const verifier: CertificationVerifier = {
      verify: async (tx, { evidence }) => {
        const [proof] = await tx`select 1 from model_test_observations where digest=${hash(evidence)}`;
        return proof ? 'PASS' : 'UNVERIFIED';
      },
    };
    await db`create table model_test_observations(digest text primary key)`;
    await db`create table model_test_scope(machine_id uuid,project_id uuid,primary key(machine_id,project_id))`;
    const f = await modelFixture(db, {
      authorizeDispatch: (...a) => authority(...a),
      projectionPolicy: policy,
      configure: async (app, options, deps) => registerModelTestIssuer(app, options, deps),
      modelPorts: {
        certificationVerifier: verifier,
        probeVerifier: {
          verify: async (tx, probe) => {
            const [proof] = await tx`select 1 from model_test_observations where digest=${hash(probe)}`;
            return proof
              ? { status: 'pass', capabilities: ['text', 'tools'] }
              : { status: 'unverified', capabilities: [] };
          },
        },
      },
    });
    try {
      const boot = randomUUID();
      assert.equal(
        (
          await f.owner.put(`/v2/machines/${f.machineId}/model-sources`, {
            expectedRevision: 0,
            enabled: { claude: false, codex: true, api: false },
            apiProviders: [],
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, nextConfig)).statusCode,
        200,
      );
      await f.machine.post('/v2/gateway/boots', { bootId: boot, previousGeneration: '0' });
      await f.machine.post('/v2/gateway/install-reports', report(boot, '1'));
      const inv = {
        reportId: randomUUID(),
        bootId: boot,
        bootGeneration: '1',
        sequence: '1',
        configRevision: 1,
        body: {
          entries: [
            {
              key: { machineId: f.machineId, runtime: 'codex', providerId: 'codex', modelId: 'x' },
              context: ctx,
              observedAt: new Date().toISOString(),
              status: 'unverified',
              capabilities: [],
              evidenceDigest: 'a'.repeat(64),
              errorCode: null,
              runtimeVersion: 'test',
            },
          ],
        },
      };
      assert.equal((await f.machine.post('/v2/machine/models/inventory', inv)).statusCode, 200);
      const initialApplied = {
        reportId: randomUUID(),
        bootId: boot,
        bootGeneration: '1',
        sequence: '2',
        configRevision: 1,
        body: {
          inventoryReportId: inv.reportId,
          sourceStatus: {
            claude: { state: 'disabled', errorCode: null },
            codex: { state: 'ready', errorCode: null },
            api: { state: 'disabled', errorCode: null },
          },
          observationDigest: hash(inv.body),
        },
      };
      assert.equal((await f.machine.post('/v2/machine/models/applied', initialApplied)).statusCode, 200);
      const s = await prepareSelection(f, db);
      await db`insert into model_test_scope values(${f.machineId},${s.tickets.project.id})`;
      const [probe] = await db`select id from model_probe_receipts`;
      const choice: ModelDispatchChoice = {
        model: { machineId: f.machineId, runtime: 'codex', providerId: 'codex', modelId: 'x' },
        modelConfigRevision: 1,
        probeReceiptId: String(probe?.id),
        probeContextSha256: contextHash(ctx),
        certificationReceiptId: null,
        required: ['text'],
      };
      // Before implementation the issue service is absent; HTTP route RED above already proves missing producer.
      const challengeResponse = await f.owner.post('/v2/test/model-certifications/challenges', {
        machineId: f.machineId,
        projectId: s.tickets.project.id,
        context: ctx,
        maxTurns: 2,
        maxTools: 3,
        maxCostUsd: 0,
      });
      assert.equal(challengeResponse.statusCode, 201, challengeResponse.text);
      const challenge = challengeResponse.json<import('../src/models/contracts.ts').CertificationChallenge>();
      await db`update commands set payload=${db.json({ selection: s.selected, modelChoice: choice, certificationAdmission: { challengeId: challenge.id, nonce: challenge.nonce } })} where id=${s.commandId}`;
      await db`update decisions set scope=${db.json({ selection: s.selected, modelChoice: choice, certificationChallengeId: challenge.id })} where id=${s.decisionId}`;
      authority = async (tx, _actor, permit) => {
        const [ch] =
          await tx`select * from model_certification_challenges where id=${challenge.id} for update`;
        const [c] = await tx`select payload from commands where id=${permit.commandId}`;
        if (
          ch?.state !== 'issued' ||
          hash(
            (c?.payload as { certificationAdmission?: { challengeId: string; nonce: string } } | undefined)
              ?.certificationAdmission,
          ) !== hash({ challengeId: challenge.id, nonce: challenge.nonce })
        )
          throw new ApiError('TEST_ADMISSION_DENIED', 409, 'Fixture deny');
        await tx`select set_config('crew.model_admission',${challenge.id},true)`;
      };
      const first = await s.claim();
      assert.equal(first.statusCode, 201, first.text);
      const a = first.json<{ id: string; fence: string }>();
      assert.equal((await s.claim()).json<{ id: string }>().id, a.id);
      const [ch] = await db`select * from model_certification_challenges where id=${challenge.id}`;
      assert.equal(ch?.state, 'admitted');
      assert.equal(ch?.attempt_id, a.id);
      assert.equal(ch?.process_instance_id, s.processInstanceId);
      assert.equal(String(ch?.admitted_fence), a.fence);
      const companion = {
        fence: a.fence,
        processInstanceId: s.processInstanceId,
        sourceTreeSha256: s.selected.sourceTreeSha256,
        runtime: 'codex',
        projectionManifestSha256: s.selected.projectionManifestSha256,
        projectionTreeSha256: s.selected.projectionTreeSha256,
        installReportId: s.selected.installReportId,
      };
      const pair = await f.machine.post(`/v2/gateway/attempts/${a.id}/projection`, companion);
      assert.equal(pair.statusCode, 200, pair.text);
      assert.deepEqual(
        (await f.machine.post(`/v2/gateway/attempts/${a.id}/projection`, companion)).json(),
        pair.json(),
      );
      assert.equal(
        (await f.machine.post(`/v2/gateway/attempts/${a.id}/projection`, { ...companion, fence: '99' }))
          .statusCode,
        409,
      );
      const evidence: CertificationEvidence = {
        challengeId: challenge.id,
        attemptId: a.id,
        fence: a.fence,
        processInstanceId: s.processInstanceId,
        context: ctx,
        surfaceResults: surfaces.map((surface) => ({
          surface,
          selectedWorked: true,
          unselectedDenied: true,
          traceSha256: '6'.repeat(64),
        })),
        artifactIds: [],
        traceSha256: '7'.repeat(64),
      };
      // Incomplete host surface reports cannot become PASS even with a test observer marker.
      const incomplete = {
        ...evidence,
        surfaceResults: evidence.surfaceResults.filter((s) => s.surface !== 'child'),
      };
      await db`insert into model_test_observations(digest) values(${hash(incomplete)})`;
      const unverified = await f.machine.post('/v2/machine/models/certifications', incomplete);
      assert.equal(unverified.statusCode, 200, unverified.text);
      assert.equal(unverified.json().status, 'UNVERIFIED');
      // Only the independent test observer port can authorize a protocol receipt in this test DB.
      await db`insert into model_test_observations(digest) values(${hash(evidence)})`;
      const pass = await f.machine.post('/v2/machine/models/certifications', evidence);
      assert.equal(pass.statusCode, 200, pass.text);
      assert.equal(pass.json().status, 'PASS');
      assert.deepEqual(
        (await f.machine.post('/v2/machine/models/certifications', evidence)).json(),
        pass.json(),
      );
      assert.equal(
        (
          await f.machine.post('/v2/machine/models/certifications', {
            ...evidence,
            traceSha256: '8'.repeat(64),
          })
        ).statusCode,
        409,
      );
      await db`update tickets set status='ready',workflow_pin=${db.json({ workflow: 'superpowers', version: '6.4.2', revision: '8ca22dba9a94f28898bbce59f2537ff4d87c747d', checksum: 'e'.repeat(64) })} where id=${s.tickets.b.id}`;
      const b = await f.owner.post('/v2/commands', {
        machineId: f.machineId,
        ticketId: s.tickets.b.id,
        type: 'start',
        payload: {
          selection: s.selected,
          modelChoice: choice,
          certificationAdmission: { challengeId: challenge.id, nonce: challenge.nonce },
        },
      });
      assert.equal(b.statusCode, 202, b.text);
      const now = Date.now();
      const denied = await f.machine.post(`/v2/machine/commands/${b.json<{ id: string }>().id}/claim`, {
        processInstanceId: randomUUID(),
        permit: {
          commandId: b.json<{ id: string }>().id,
          ticketId: s.tickets.b.id,
          machineId: f.machineId,
          bindingRevision: 2,
          ticketRevision: 1,
          workflow: {
            workflow: 'superpowers',
            version: '6.4.2',
            revision: '8ca22dba9a94f28898bbce59f2537ff4d87c747d',
            checksum: 'e'.repeat(64),
          },
          checkedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 20000).toISOString(),
          telemetryId: randomUUID(),
          decisionId: s.decisionId,
        },
      });
      assert.equal(denied.statusCode, 409, denied.text);

      const measured = {
        ...inv,
        reportId: randomUUID(),
        sequence: '3',
        body: { entries: [{ ...inv.body.entries[0], status: 'pass', capabilities: ['text', 'tools'] }] },
      };
      await db`insert into model_test_observations(digest) values(${hash(measured.body.entries[0])})`;
      assert.equal((await f.machine.post('/v2/machine/models/inventory', measured)).statusCode, 200);
      const applied = {
        reportId: randomUUID(),
        bootId: boot,
        bootGeneration: '1',
        sequence: '4',
        configRevision: 1,
        body: {
          inventoryReportId: measured.reportId,
          sourceStatus: {
            claude: { state: 'disabled', errorCode: null },
            codex: { state: 'ready', errorCode: null },
            api: { state: 'disabled', errorCode: null },
          },
          observationDigest: hash(measured.body),
        },
      };
      assert.equal((await f.machine.post('/v2/machine/models/applied', applied)).statusCode, 200);
      const { getPool, assertModelDispatch } = await import('../src/models/catalog.ts');
      const pool = await getPool(db, f.machineId, source('superpowers'));
      assert.equal(pool[0]?.available, true);
      const [cert] = await db`select id from runtime_certification_receipts`;
      const normalChoice = {
        ...choice,
        probeReceiptId: String(pool[0].probeReceiptId),
        certificationReceiptId: String(cert?.id),
      };
      await db`update commands set payload=${db.json({ selection: s.selected, modelChoice: normalChoice })} where id=${s.commandId}`;
      await db`update decisions set scope=${db.json({ selection: s.selected, modelChoice: normalChoice })} where id=${s.decisionId}`;
      const permit = {
        commandId: s.commandId,
        ticketId: s.tickets.a.id,
        machineId: f.machineId,
        bindingRevision: 2,
        ticketRevision: 1,
        workflow: {
          workflow: 'superpowers' as const,
          version: '6.4.2',
          revision: '8ca22dba9a94f28898bbce59f2537ff4d87c747d',
          checksum: 'e'.repeat(64),
        },
        checkedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 20000).toISOString(),
        telemetryId: randomUUID(),
        decisionId: s.decisionId,
      };
      await db.begin((tx) => assertModelDispatch(tx, permit, normalChoice));
      await assert.rejects(
        db.begin((tx) => assertModelDispatch(tx, permit, { ...normalChoice, required: ['vision'] })),
      );
      const changed = {
        ...measured,
        reportId: randomUUID(),
        sequence: '5',
        body: {
          entries: [{ ...measured.body.entries[0], context: { ...ctx, binarySha256: '9'.repeat(64) } }],
        },
      };
      await db`insert into model_test_observations(digest) values(${hash(changed.body.entries[0])})`;
      assert.equal((await f.machine.post('/v2/machine/models/inventory', changed)).statusCode, 200);
      assert.equal(
        (
          await f.machine.post('/v2/machine/models/applied', {
            ...applied,
            reportId: randomUUID(),
            sequence: '6',
            body: {
              ...applied.body,
              inventoryReportId: changed.reportId,
              observationDigest: hash(changed.body),
            },
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (await getPool(db, f.machineId, source('superpowers')))[0]?.reason,
        'CERTIFICATION_UNVERIFIED',
      );
      await assert.rejects(db.begin((tx) => assertModelDispatch(tx, permit, normalChoice)));
      const next = structuredClone(nextConfig);
      next.expectedRevision = 1;
      next.desired.superpowers.projections.codex = {
        ...projection('superpowers'),
        treeSha256: '9'.repeat(64),
      };
      assert.equal((await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, next)).statusCode, 200);
      assert.equal(
        (await getPool(db, f.machineId, source('superpowers')))[0]?.reason,
        'WORKFLOW_UNAVAILABLE',
      );
      const installed = report(boot, '1', 2);
      installed.results.superpowers.projections.codex.installed = next.desired.superpowers.projections.codex;
      assert.equal((await f.machine.post('/v2/gateway/install-reports', installed)).statusCode, 200);
      assert.equal(
        (await getPool(db, f.machineId, source('superpowers')))[0]?.reason,
        'PROBE_CONTEXT_CHANGED',
      );
      const failed = {
        ...measured,
        reportId: randomUUID(),
        sequence: '7',
        body: { entries: [{ ...measured.body.entries[0], status: 'fail', errorCode: 'AUTH' }] },
      };
      assert.equal((await f.machine.post('/v2/machine/models/inventory', failed)).statusCode, 200);
      await assert.rejects(db.begin((tx) => assertModelDispatch(tx, permit, normalChoice)));
      assert.equal(
        (
          await f.owner.put(`/v2/machines/${f.machineId}/model-sources`, {
            expectedRevision: 1,
            enabled: { claude: false, codex: false, api: false },
            apiProviders: [],
          })
        ).statusCode,
        200,
      );
      await assert.rejects(
        db.begin((tx) => assertModelDispatch(tx, permit, normalChoice)),
        (err) => err instanceof ApiError && err.code === 'SOURCE_DISABLED',
      );
      const [attemptCount] = await db`select count(*)::int as value from attempts`;
      assert.equal(attemptCount?.value, 1);
    } finally {
      await f.close();
    }
  });
});
