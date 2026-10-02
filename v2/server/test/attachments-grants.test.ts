import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  createInputReadAuthorization,
  denyAssistantInput,
  issueAssistantReadGrant,
} from '../src/attachments/grants.ts';
import { attachmentAccessFixture } from './support/attachment-access.ts';
import { databaseFixture } from './support/db.ts';
import { owner } from './support/tickets.ts';

test('attachment grants default deny and owner authorization cannot include unsubmitted or foreign originals', async () => {
  await databaseFixture(10)(async (db) => {
    const f = await attachmentAccessFixture(db);
    try {
      const a = await f.linkFile('A', Buffer.from('A')),
        b = await f.linkFile('B', Buffer.from('B'));
      const target = { kind: 'ticket' as const, ticketId: f.tickets.A.id, projectId: f.projects.A.id };
      const input = {
        target,
        originals: [a],
        allowOriginal: false,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };
      await assert.rejects(
        f.mutation((tx) => createInputReadAuthorization(tx, { ...input, originals: [b] }, owner)),
        { code: 'NOT_FOUND' },
      );
      await assert.rejects(
        f.mutation((tx) =>
          createInputReadAuthorization(
            tx,
            { ...input, originals: [{ ...a, sha256: '0'.repeat(64) }] },
            owner,
          ),
        ),
        { code: 'NOT_FOUND' },
      );
      await assert.rejects(
        f.mutation((tx) =>
          createInputReadAuthorization(
            tx,
            { ...input, expiresAt: new Date(Date.now() + 25 * 3600000).toISOString() },
            owner,
          ),
        ),
        { code: 'VALIDATION' },
      );
      const auth = await f.mutation((tx) => createInputReadAuthorization(tx, input, owner));
      await assert.rejects(
        f.mutation((tx) =>
          issueAssistantReadGrant(
            tx,
            { authorizationId: auth.id, target, inputRevision: '2' },
            owner,
            denyAssistantInput,
          ),
        ),
        { code: 'ASSISTANT_INPUT_NOT_CONFIGURED' },
      );
      const machine = await f.machineRequest('A', 'POST', '/v2/attachment-assistant-grants', {
        authorizationId: auth.id,
        target,
        inputRevision: '2',
      });
      assert.equal(machine.statusCode, 403, machine.body);
      const unknown = await f.ownerRequest('POST', '/v2/input-snapshots', {
        target,
        access: { kind: 'owner' },
        expectedInputRevision: null,
        scopeDecisionId: null,
        requiredCapabilities: [],
      });
      assert.equal(unknown.statusCode, 400);
      const revoke = await f.ownerRequest(
        'DELETE',
        `/v2/attachment-submission-authorizations/${auth.id}`,
        {},
      );
      assert.equal(revoke.statusCode, 200, revoke.body);
      const [row] = await db`select revoked_at from attachment_submission_authorizations where id=${auth.id}`;
      assert.ok(row.revoked_at);
      assert.equal(
        (await f.ownerRequest('DELETE', `/v2/attachment-submission-authorizations/${randomUUID()}`, {}))
          .statusCode,
        404,
      );
    } finally {
      await f.close();
    }
  });
});

test('attachment Assistant directly reads submitted inbox representation; OFF preserves exact admission and revocation cuts access', async () => {
  const { assistantProtocolAuthority } = await import('./support/attachment-access-authority.ts');
  const { fixturePng, publishKnownRepresentation } = await import(
    './support/attachment-access-publication.ts'
  );
  const { setSourceConfig } = await import('../src/models/config.ts');
  const { sha } = await import('./support/attachments.ts');
  await databaseFixture(10)(async (db) => {
    const port = assistantProtocolAuthority(),
      f = await attachmentAccessFixture(db, { assistant: port.authority });
    try {
      port.setMachine(f.machines.A.machineId);
      await f.mutation((tx) =>
        setSourceConfig(tx, f.machines.A.machineId, {
          expectedRevision: 0,
          enabled: { claude: false, codex: true, api: false },
          apiProviders: [],
        }),
      );
      const conversation = await f.ownerRequest('POST', '/v2/attachment-conversations', {});
      assert.equal(conversation.statusCode, 201, conversation.body);
      const conversationId = conversation.json().conversationId;
      const compose = await f.ownerRequest('POST', '/v2/attachment-compose', {
        purpose: 'assistant_message',
        projectId: null,
        ticketId: null,
        conversationId,
      });
      assert.equal(compose.statusCode, 201, compose.body);
      const composeId = compose.json().id;
      const reserve = await f.ownerRequest('POST', `/v2/attachment-compose/${composeId}/uploads`, {
        expectedRevision: 1,
        fileName: 'pixel.png',
        declaredMime: 'image/png',
        byteLength: fixturePng.length,
        sha256: sha(fixturePng),
      });
      assert.equal(reserve.statusCode, 201, reserve.body);
      const original = reserve.json().attachment;
      const upload = await f.app.inject({
        method: 'PUT',
        url: `/v2/attachment-uploads/${original.attachmentId}/content`,
        payload: fixturePng,
        headers: { ...f.ownerHeaders, 'content-type': 'application/octet-stream' },
      });
      assert.equal(upload.statusCode, 201, upload.body);
      const submitted = await f.ownerRequest('POST', '/v2/attachment-submissions/messages', {
        conversationId,
        clientMessageId: randomUUID(),
        text: '',
        selection: {
          composeSessionId: composeId,
          selectionRevision: reserve.json().selectionRevision,
          attachmentIds: [original.attachmentId],
        },
        assistantRead: 'selected-inputs',
      });
      assert.equal(submitted.statusCode, 201, submitted.body);
      const message = submitted.json();
      const extraction = await publishKnownRepresentation(f, {
        attachmentId: original.attachmentId,
        sha256: original.sha256,
        ownerId: 'owner',
      });
      const [authorization] =
        await db`select id from attachment_submission_authorizations where target_kind='message' and target_id=${message.id}`;
      const [revision] =
        await db`select revision from attachment_input_revisions where target_kind='message' and target_id=${message.id}`;
      const target = { kind: 'message', messageId: message.id };
      const granted = await f.ownerRequest('POST', '/v2/attachment-assistant-grants', {
        authorizationId: authorization.id,
        target,
        inputRevision: String(revision.revision),
      });
      assert.equal(granted.statusCode, 201, granted.body);
      const grant = granted.json();
      const snap = await f.machineRequest('A', 'POST', '/v2/input-snapshots', {
        target,
        access: {
          kind: 'assistant-grant',
          grantId: grant.id,
          designationRevision: grant.designationRevision,
        },
        expectedInputRevision: null,
        scopeDecisionId: null,
      });
      assert.equal(snap.statusCode, 200, snap.body);
      const snapshot = snap.json();
      assert.equal(snapshot.state, 'ready');
      assert.deepEqual(snapshot.requiredCapabilities, ['vision']);
      assert.ok(!snap.body.includes(f.base.root));
      const bound = await f.machineRequest(
        'A',
        'POST',
        `/v2/machine/assistant-input-grants/${grant.id}/bind-snapshot`,
        { snapshotId: snapshot.id },
      );
      assert.equal(bound.statusCode, 200, bound.body);
      const startBody = { grantId: grant.id, snapshotId: snapshot.id, modelSelectionId: randomUUID() };
      const start = await f.machineRequest('A', 'POST', '/v2/machine/assistant-input-sessions', startBody);
      assert.equal(start.statusCode, 201, start.body);
      const session = start.json();
      assert.equal(port.admittedCount, 1);
      const derivative = extraction.derivatives[0];
      assert.ok(derivative);
      const path = `/v2/machine/assistant-input-sessions/${session.id}/representations/${derivative.id}?grantId=${grant.id}&snapshotId=${snapshot.id}`;
      await db`update machines set revoked_at=now() where id=${f.machines.B.machineId}`;
      const before = await f.machineRequest('A', 'GET', path);
      assert.equal(before.statusCode, 200, before.body);
      assert.deepEqual(before.rawPayload, fixturePng);
      assert.equal((await f.machineRequest('B', 'GET', path)).statusCode, 401);
      assert.equal(
        (
          await f.machineRequest(
            'A',
            'GET',
            `/v2/machine/assistant-input-sessions/${session.id}/originals/${original.attachmentId}?grantId=${grant.id}&snapshotId=${snapshot.id}`,
          )
        ).statusCode,
        403,
      );
      await f.mutation((tx) =>
        setSourceConfig(tx, f.machines.A.machineId, {
          expectedRevision: 1,
          enabled: { claude: false, codex: false, api: false },
          apiProviders: [],
        }),
      );
      const replay = await f.machineRequest('A', 'POST', '/v2/machine/assistant-input-sessions', startBody);
      assert.equal(replay.statusCode, 201, replay.body);
      assert.deepEqual(replay.json(), session);
      assert.equal(port.admittedCount, 1);
      const fresh = await f.machineRequest('A', 'POST', '/v2/machine/assistant-input-sessions', {
        ...startBody,
        modelSelectionId: randomUUID(),
      });
      assert.equal(fresh.statusCode, 409, fresh.body);
      assert.equal(fresh.json().error.code, 'SOURCE_DISABLED');
      const after = await f.machineRequest('A', 'GET', path);
      assert.equal(after.statusCode, 200, after.body);
      const receipt = {
        sessionId: session.id,
        grantId: grant.id,
        snapshotId: snapshot.id,
        snapshotSha256: snapshot.sha256,
        runtime: session.runtime,
        modelKey: session.modelKey,
        delivered: [
          { derivativeId: derivative.id, sha256: derivative.sha256, unitIds: ['u1'], modality: 'vision' },
        ],
        status: 'delivered',
        transportEvidenceSha256: sha(after.rawPayload),
      };
      const saved = await f.machineRequest('A', 'POST', '/v2/machine/assistant-input-read-receipts', receipt);
      assert.equal(saved.statusCode, 201, saved.body);
      assert.equal(saved.json().coverage, 'all_selected');
      assert.equal(saved.json().trust, 'reported_transport');
      const replayReceipt = await f.machineRequest(
        'A',
        'POST',
        '/v2/machine/assistant-input-read-receipts',
        receipt,
      );
      assert.equal(replayReceipt.statusCode, 201, replayReceipt.body);
      assert.deepEqual(replayReceipt.json(), saved.json());
      assert.equal(
        (
          await f.machineRequest('A', 'POST', '/v2/machine/assistant-input-read-receipts', {
            ...receipt,
            delivered: [],
          })
        ).statusCode,
        422,
      );
      assert.equal(
        (
          await f.machineRequest('A', 'POST', '/v2/machine/assistant-input-read-receipts', {
            ...receipt,
            modelKey: 'wrong',
          })
        ).statusCode,
        422,
      );
      const revoked = await f.ownerRequest('DELETE', `/v2/attachment-assistant-grants/${grant.id}`, {});
      assert.equal(revoked.statusCode, 200, revoked.body);
      assert.equal((await f.machineRequest('A', 'GET', path)).statusCode, 404);
      assert.equal(
        (await f.machineRequest('A', 'POST', '/v2/machine/assistant-input-sessions', startBody)).statusCode,
        404,
      );
    } finally {
      await f.close();
    }
  });
});

test('direct accepted reply writer and publication/revocation serialize both winning orders without input-root inversion', async () => {
  const { admittedInboxFixture } = await import('./support/attachment-access-inbox.ts');
  const { openPeerDb } = await import('./support/execution.ts');
  const { publishKnownRepresentation } = await import('./support/attachment-access-publication.ts');
  const { revokeAssistantGrant } = await import('../src/attachments/grants.ts');
  const { mutate } = await import('../src/journal/mutation.ts');
  const { setTimeout: delay } = await import('node:timers/promises');
  for (const operation of ['publication', 'revoke'] as const)
    for (const winner of ['change', 'reply'] as const)
      await databaseFixture(10)(async (db) => {
        let release!: () => void;
        const barrier = new Promise<void>((r) => {
          release = r;
        });
        let entered!: () => void;
        const reached = new Promise<void>((r) => {
          entered = r;
        });
        const f = await admittedInboxFixture(
            db,
            winner === 'reply'
              ? async () => {
                  entered();
                  await barrier;
                }
              : undefined,
            true,
          ),
          peer = await openPeerDb(db);
        const pending: Promise<unknown>[] = [];
        try {
          // NEW pending extraction queue is a controlled version fixture, not a
          // production re-extraction enqueue API or an arbitrary verified manifest.
          if (operation === 'publication')
            await db`insert into attachment_extractions(id,attachment_id,original_sha256,extractor_version,config_sha256,status) values(${randomUUID()},${f.original.attachmentId},${f.original.sha256},'protocol-fixture-next',${f.base.config.policySha256},'pending')`;
          const reply = () =>
            db
              .begin((tx) => f.messages.persistMessageInputDecision(tx, f.reply, f.actors.A))
              .then(
                (id) => ({ ok: true as const, id }),
                (error) => ({ ok: false as const, code: error.code }),
              );
          const change = () =>
            operation === 'publication'
              ? publishKnownRepresentation(
                  { ...f, db: peer },
                  f.original,
                  'image',
                  winner === 'change'
                    ? async () => {
                        entered();
                        await barrier;
                      }
                    : undefined,
                )
              : mutate(
                  peer,
                  { actor: owner, route: 'fixture:revoke', key: randomUUID(), body: {} },
                  async (tx) => {
                    const body = await revokeAssistantGrant(tx, f.grant.id, owner);
                    if (winner === 'change') {
                      entered();
                      await barrier;
                    }
                    return { status: 200, body };
                  },
                );
          const first = winner === 'change' ? change() : reply();
          pending.push(first);
          await reached;
          const second = winner === 'change' ? reply() : change();
          pending.push(second);
          let blocked = false;
          for (let i = 0; i < 200; i++) {
            const [row] =
              await db`select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and (query like '%attachment_messages%' or query like '%attachment_input_revisions%' or query like '%tickets%')`;
            if (row) {
              blocked = true;
              break;
            }
            await delay(10);
          }
          assert.equal(blocked, true, 'second actual writer reached locked message');
          release();
          const [one, two] = await Promise.all([first, second]);
          const result = winner === 'change' ? two : one;
          assert.equal((result as { ok: boolean }).ok, winner === 'reply');
          const [stored] =
            await db`select count(*)::int n from attachment_message_decisions where message_id=${f.message.id} and kind='reply'`;
          assert.equal(stored.n, winner === 'reply' ? 1 : 0);
          await assert.rejects(
            db.begin((tx) => f.messages.persistMessageInputDecision(tx, f.reply, f.actors.A)),
          );
          assert.equal(
            (await f.machineRequest('A', 'POST', '/v2/machine/assistant-input-sessions', f.startBody))
              .statusCode,
            404,
          );
        } finally {
          release();
          await Promise.allSettled(pending);
          await peer.end();
          await f.close();
        }
      });
});

test('terminal assistant session denies identical idempotency cache replay before callback', async () => {
  const { admittedInboxFixture } = await import('./support/attachment-access-inbox.ts');
  await databaseFixture(10)(async (db) => {
    const f = await admittedInboxFixture(db);
    try {
      const key = randomUUID(),
        first = await f.machineRequest('A', 'POST', '/v2/machine/assistant-input-sessions', f.startBody, key);
      assert.equal(first.statusCode, 201, first.body);
      await db`update attachment_assistant_sessions set state='stopped' where id=${f.session.id}`;
      const replay = await f.machineRequest(
        'A',
        'POST',
        '/v2/machine/assistant-input-sessions',
        f.startBody,
        key,
      );
      assert.equal(replay.statusCode, 409, replay.body);
      assert.equal(replay.json().error.code, 'ASSISTANT_SESSION_NOT_ACTIVE');
    } finally {
      await f.close();
    }
  });
});
