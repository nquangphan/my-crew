import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  assertAttachmentExecutionCurrent,
  authorizeAttachment,
  denyAttachmentExecution,
} from '../src/attachments/access.ts';
import { inheritAttachmentLinks } from '../src/attachments/references.ts';
import { attachmentAccessFixture } from './support/attachment-access.ts';
import { databaseFixture } from './support/db.ts';
import { owner } from './support/tickets.ts';

test('attachment access never follows a matching checksum across projects', async () => {
  await databaseFixture(10)(async (db) => {
    const f = await attachmentAccessFixture(db);
    try {
      const a = await f.linkFile('A', Buffer.from('same bytes'));
      const b = await f.linkFile('B', Buffer.from('same bytes'));
      assert.equal(a.sha256, b.sha256);
      assert.notEqual(a.attachmentId, b.attachmentId);
      assert.equal((await f.machineDownload('A', b.attachmentId)).statusCode, 404);
      const ok = await f.machineDownload('A', a.attachmentId);
      assert.equal(ok.statusCode, 200, ok.body);
      assert.equal(ok.body, 'same bytes');
      assert.equal((await f.machineDownload('A', a.attachmentId, { fence: '999' })).statusCode, 409);
      assert.equal(
        (await f.machineDownload('A', a.attachmentId, { projectId: f.projects.B.id })).statusCode,
        404,
      );
      assert.equal((await f.machineDownload('A', randomUUID())).statusCode, 404);
      await assert.rejects(
        db.begin((tx) =>
          authorizeAttachment(
            tx,
            f.actors.A,
            { attachmentId: a.attachmentId, context: f.contexts.A, derivativeId: null, manifestId: null },
            denyAttachmentExecution,
          ),
        ),
        { code: 'ATTACHMENT_EXECUTION_NOT_CONFIGURED' },
      );
    } finally {
      await f.close();
    }
  });
});

test('attachment references require a live ancestor in the exact tree and reuse original identity', async () => {
  await databaseFixture(10)(async (db) => {
    const f = await attachmentAccessFixture(db);
    try {
      const a = await f.linkFile('A', Buffer.from('ancestor'));
      const child = await f.child('A');
      const sibling = await f.sibling('A');
      const [source] = await db`select id from attachment_links where attachment_id=${a.attachmentId}`;
      const ids = await f.mutation((tx) => inheritAttachmentLinks(tx, child.id, [String(source.id)], owner));
      assert.equal(ids.length, 1);
      const [link] =
        await db`select attachment_id,inherited_from_link_id from attachment_links where id=${ids[0]}`;
      assert.equal(link.attachment_id, a.attachmentId);
      assert.equal(link.inherited_from_link_id, source.id);
      await assert.rejects(
        f.mutation((tx) => inheritAttachmentLinks(tx, sibling.id, ids, owner)),
        { code: 'NOT_FOUND' },
      );
      await assert.rejects(
        f.mutation((tx) => inheritAttachmentLinks(tx, f.tickets.B.id, [String(source.id)], owner)),
        { code: 'NOT_FOUND' },
      );
      await db`update attachment_links set revoked_at=now() where id=${source.id}`;
      await assert.rejects(
        f.mutation((tx) => inheritAttachmentLinks(tx, child.id, [String(source.id)], owner)),
        { code: 'NOT_FOUND' },
      );
      await assert.rejects(
        db.begin((tx) =>
          authorizeAttachment(
            tx,
            f.actors.A,
            { attachmentId: a.attachmentId, context: f.contexts.A, derivativeId: null, manifestId: null },
            assertAttachmentExecutionCurrent,
          ),
        ),
        { code: 'NOT_FOUND' },
      );
    } finally {
      await f.close();
    }
  });
});

test('actual cancellation/reconcile and owner rebind invalidate old attachment fence; uncertain lease fails closed', async () => {
  const { recordDecision } = await import('../src/tickets/decisions.ts');
  await databaseFixture(10)(async (db) => {
    const f = await attachmentAccessFixture(db);
    try {
      const original = await f.linkFile('A', Buffer.from('current'));
      const [lease] = await db`select lease_expires_at from attempts where id=${f.contexts.A.attemptId}`;
      await db`update attempts set lease_expires_at=clock_timestamp()-interval '1 second' where id=${f.contexts.A.attemptId}`;
      const uncertain = await f.machineDownload('A', original.attachmentId);
      assert.equal(uncertain.statusCode, 409, uncertain.body);
      assert.equal(uncertain.json().error.code, 'ATTEMPT_NOT_ACTIVE');
      await db`update attempts set lease_expires_at=${lease.lease_expires_at} where id=${f.contexts.A.attemptId}`;
      const decision = await f.mutation((tx) =>
        recordDecision(
          tx,
          f.tickets.A.id,
          {
            kind: 'assessment',
            content: 'Stop fixture',
            rationale: 'Stop before rebind',
            sources: [],
            scope: {},
          },
          owner,
        ),
      );
      const cancel = await f.ownerRequest('POST', '/v2/commands', {
        machineId: f.machines.A.machineId,
        ticketId: f.tickets.A.id,
        type: 'cancel',
        payload: { decisionId: decision, reason: 'Controlled stop' },
      });
      assert.equal(cancel.statusCode, 202, cancel.body);
      const stopped = await f.machineRequest(
        'A',
        'POST',
        `/v2/machine/attempts/${f.contexts.A.attemptId}/reconcile`,
        {
          fence: f.contexts.A.fence,
          processInstanceId: f.contexts.A.processInstanceId,
          observation: 'stopped',
          artifacts: [],
          stopReason: 'cancel',
        },
      );
      assert.equal(stopped.statusCode, 200, stopped.body);
      assert.equal((await f.machineDownload('A', original.attachmentId)).statusCode, 409);
      const rebound = await f.ownerRequest('PUT', `/v2/projects/${f.projects.A.id}/binding`, {
        machineId: f.machines.B.machineId,
        checkoutPath: '/tmp/crew-test-rebound',
        expectedRevision: 2,
      });
      assert.equal(rebound.statusCode, 200, rebound.body);
      assert.equal((await f.machineDownload('A', original.attachmentId)).statusCode, 404);
      assert.equal(
        (await f.machineDownload('B', original.attachmentId, { ...f.contexts.A, bindingRevision: 3 }))
          .statusCode,
        404,
      );
    } finally {
      await f.close();
    }
  });
});

test('verified derivative identity belongs to its exact original even for matching bytes', async () => {
  const { fixturePng, publishKnownRepresentation } = await import(
    './support/attachment-access-publication.ts'
  );
  await databaseFixture(10)(async (db) => {
    const f = await attachmentAccessFixture(db);
    try {
      const a = await f.linkFile('A', fixturePng, 'a.png'),
        b = await f.linkFile('B', fixturePng, 'b.png');
      const ea = await publishKnownRepresentation(f, a),
        eb = await publishKnownRepresentation(f, b);
      const da = ea.derivatives[0],
        dbDerivative = eb.derivatives[0];
      assert.ok(da);
      assert.ok(dbDerivative);
      const ownerGet = (originalId: string, derivativeId: string) =>
        f.app.inject({
          method: 'GET',
          url: `/v2/attachments/${originalId}/derivatives/${derivativeId}/content`,
          headers: { cookie: f.cookie },
        });
      assert.equal((await ownerGet(a.attachmentId, da.id)).statusCode, 200);
      assert.equal((await ownerGet(a.attachmentId, dbDerivative.id)).statusCode, 404);
      const base = `/v2/machine/attachments/${a.attachmentId}/content?${new URLSearchParams(Object.entries(f.contexts.A).map(([k, v]) => [k, String(v)]))}`;
      assert.equal((await f.machineRequest('A', 'GET', `${base}&derivativeId=${da.id}`)).statusCode, 200);
      assert.equal(
        (await f.machineRequest('A', 'GET', `${base}&derivativeId=${dbDerivative.id}`)).statusCode,
        404,
      );
    } finally {
      await f.close();
    }
  });
});
