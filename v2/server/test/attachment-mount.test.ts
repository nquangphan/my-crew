import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { bootstrapOwner } from '../src/auth/bootstrap.ts';
import type { Db } from '../src/platform/contracts.ts';
import { attachmentFixture, sha } from './support/attachments.ts';
import { databaseFixture } from './support/db.ts';
import { inputTicket } from './support/tickets.ts';

const origin = 'http://localhost:5182';
type Selection = { composeSessionId: string; selectionRevision: number; attachmentIds: string[] };
type Ref = {
  linkId: string;
  attachmentId: string;
  sha256: string;
  ownerId: 'owner';
  fileName: string;
  mime: string | null;
  byteLength: number;
};

// Production buildApp with the real stage/submission/message factories. Only the
// upload writer port is the macOS fixture registry: the native registry requires
// Linux /proc identity and is exercised by the attachment staging suite.
async function mountedApp(db: Db, assembly: { storage: boolean; extractorVersion?: string }) {
  const password = randomBytes(24).toString('hex');
  await bootstrapOwner(db, password);
  const base = await attachmentFixture(db);
  let app: FastifyInstance | undefined;
  try {
    app = await buildApp({
      db,
      publicOrigin: origin,
      secureCookies: false,
      sessionEncryptionKey: randomBytes(32),
      now: () => new Date(),
      ...(assembly.storage
        ? {
            attachments: {
              config: base.config,
              storageHostId: randomUUID(),
              receivers: base.receivers,
              extractorVersion: assembly.extractorVersion,
            },
          }
        : {}),
    });
    const login = await app.inject({
      method: 'POST',
      url: '/v2/auth/session',
      payload: { password },
      headers: { origin },
    });
    assert.equal(login.statusCode, 200, login.body);
    const cookie = login.headers['set-cookie']?.toString().split(';')[0] ?? '';
    const ownerHeaders = { cookie, origin, 'x-csrf-token': login.json<{ csrfToken: string }>().csrfToken };
    const mounted = app;
    const owner = (method: 'POST' | 'DELETE', url: string, payload: unknown) =>
      mounted.inject({
        method,
        url,
        payload: JSON.stringify(payload),
        headers: { ...ownerHeaders, 'idempotency-key': randomUUID(), 'content-type': 'application/json' },
      });
    const get = (url: string, headers: Record<string, string> = { cookie }) =>
      mounted.inject({ method: 'GET', url, headers });
    const upload = (attachmentId: string, bytes: Buffer, headers: Record<string, string> = ownerHeaders) =>
      mounted.inject({
        method: 'PUT',
        url: `/v2/attachment-uploads/${attachmentId}/content`,
        payload: bytes,
        headers: { ...headers, 'content-type': 'application/octet-stream' },
      });
    async function ready(target: Record<string, unknown>, files: Buffer[]): Promise<Selection> {
      const compose = await owner('POST', '/v2/attachment-compose', target);
      assert.equal(compose.statusCode, 201, compose.body);
      const id = compose.json<{ id: string; revision: number }>().id;
      let revision = compose.json<{ revision: number }>().revision;
      const attachmentIds: string[] = [];
      for (const [index, bytes] of files.entries()) {
        const reserved = await owner('POST', `/v2/attachment-compose/${id}/uploads`, {
          expectedRevision: revision,
          fileName: `input-${index}.txt`,
          declaredMime: 'text/plain',
          byteLength: bytes.length,
          sha256: sha(bytes),
        });
        assert.equal(reserved.statusCode, 201, reserved.body);
        const body = reserved.json<{ attachment: { attachmentId: string }; selectionRevision: number }>();
        revision = body.selectionRevision;
        const put = await upload(body.attachment.attachmentId, bytes);
        assert.equal(put.statusCode, 201, put.body);
        attachmentIds.push(body.attachment.attachmentId);
      }
      return { composeSessionId: id, selectionRevision: revision, attachmentIds };
    }
    async function comment(ticketId: string, files: Buffer[], text = 'ghi chú') {
      const selection = await ready({ purpose: 'comment', projectId: base.project.id, ticketId }, files);
      const created = await owner('POST', `/v2/tickets/${ticketId}/attachment-comments`, {
        text,
        selection,
        assistantRead: 'none',
      });
      return { created, selection };
    }
    const close = async () => {
      try {
        await mounted.close();
      } finally {
        await base.close();
      }
    };
    return { app: mounted, base, cookie, ownerHeaders, owner, get, upload, ready, comment, close };
  } catch (error) {
    await app?.close();
    await base.close();
    throw error;
  }
}

test('attachment mount: buildApp serves owner policy, upload, download and lists with session, CSRF and ACL', async () => {
  await databaseFixture(11)(async (db) => {
    const f = await mountedApp(db, { storage: true, extractorVersion: 'mount-test-extractor' });
    try {
      assert.equal((await f.get('/v2/attachment-policy', {})).statusCode, 401);
      const policy = await f.get('/v2/attachment-policy');
      assert.equal(policy.statusCode, 200, policy.body);
      assert.ok(!policy.body.includes(f.base.root));
      assert.equal(policy.json<{ maxFileBytes: number }>().maxFileBytes, f.base.config.maxFileBytes);

      const bytes = Buffer.from('mounted bytes');
      const target = { purpose: 'comment', projectId: f.base.project.id, ticketId: f.base.a.id };
      const compose = await f.owner('POST', '/v2/attachment-compose', target);
      assert.equal(compose.statusCode, 201, compose.body);
      const composeId = compose.json<{ id: string }>().id;
      const reserved = await f.owner('POST', `/v2/attachment-compose/${composeId}/uploads`, {
        expectedRevision: compose.json<{ revision: number }>().revision,
        fileName: 'mounted.txt',
        declaredMime: 'text/plain',
        byteLength: bytes.length,
        sha256: sha(bytes),
      });
      assert.equal(reserved.statusCode, 201, reserved.body);
      const attachmentId = reserved.json<{ attachment: { attachmentId: string } }>().attachment.attachmentId;
      const noCsrf = await f.upload(attachmentId, bytes, { cookie: f.cookie, origin });
      assert.equal(noCsrf.statusCode, 403, noCsrf.body);
      assert.equal((await f.upload(attachmentId, bytes)).statusCode, 201);
      assert.equal((await f.upload(attachmentId, bytes)).statusCode, 200);
      const read = await f.get(`/v2/attachment-compose/${composeId}`);
      assert.equal(read.statusCode, 200, read.body);
      assert.deepEqual(
        read
          .json<{ attachments: { attachmentId: string; state: string }[] }>()
          .attachments.map((a) => [a.attachmentId, a.state]),
        [[attachmentId, 'ready']],
      );
      const download = await f.get(`/v2/attachments/${attachmentId}/content`);
      assert.equal(download.statusCode, 200, download.body);
      assert.equal(download.body, bytes.toString());
      assert.equal(download.headers['cache-control'], 'private, no-store');
      assert.match(String(download.headers['content-disposition']), /^attachment;/);
      assert.equal((await f.get(`/v2/attachments/${attachmentId}/content`, {})).statusCode, 401);

      const submitted = await f.owner('POST', `/v2/tickets/${f.base.a.id}/attachment-comments`, {
        text: '',
        selection: {
          composeSessionId: composeId,
          selectionRevision: reserved.json<{ selectionRevision: number }>().selectionRevision,
          attachmentIds: [attachmentId],
        },
        assistantRead: 'none',
      });
      assert.equal(submitted.statusCode, 201, submitted.body);
      const list = await f.get(`/v2/tickets/${f.base.a.id}/attachments`);
      assert.equal(list.statusCode, 200, list.body);
      assert.deepEqual(
        list.json<{ items: Ref[] }>().items.map((r) => ({ ...r, linkId: 'x' })),
        [
          {
            linkId: 'x',
            attachmentId,
            sha256: sha(bytes),
            ownerId: 'owner',
            fileName: 'mounted.txt',
            mime: 'text/plain',
            byteLength: bytes.length,
          },
        ],
      );

      const machine = await f.owner('POST', '/v2/machines', { name: 'unbound' });
      assert.equal(machine.statusCode, 201, machine.body);
      const bearer = { authorization: `Bearer ${machine.json<{ token: string }>().token}` };
      assert.equal((await f.get(`/v2/tickets/${f.base.a.id}/attachments`, bearer)).statusCode, 404);
      assert.equal((await f.get(`/v2/attachments/${attachmentId}/content`, bearer)).statusCode, 403);
      const other = await f.owner('POST', '/v2/projects', {
        key: `P${randomUUID().slice(0, 8).toUpperCase()}`,
        name: 'Khác',
        repositoryUrl: null,
      });
      assert.equal(other.statusCode, 201, other.body);
      const crossProject = await f.owner('POST', '/v2/attachment-compose', {
        purpose: 'comment',
        projectId: other.json<{ id: string }>().id,
        ticketId: f.base.a.id,
      });
      assert.equal(crossProject.statusCode, 404, crossProject.body);
    } finally {
      await f.close();
    }
  });
});

test('attachment mount: default production assembly keeps unproduced input ports fail-closed', async () => {
  await databaseFixture(11)(async (db) => {
    const bare = await mountedApp(db, { storage: false });
    try {
      assert.equal((await bare.get('/v2/attachment-policy')).statusCode, 404);
      const conversation = await bare.owner('POST', '/v2/attachment-conversations', {});
      assert.equal(conversation.statusCode, 409, conversation.body);
      assert.equal(conversation.json().error.code, 'INPUT_SERVICES_NOT_CONFIGURED');
      const route = await bare.owner('POST', `/v2/attachment-messages/${randomUUID()}/route`, {
        expectedInputRevision: '1',
        expectedRouteRevision: 0,
        decisionId: randomUUID(),
        ticket: inputTicket(bare.base.project.id, 'request'),
      });
      assert.equal(route.statusCode, 503, route.body);
      assert.equal(route.json().error.code, 'INPUT_ROUTING_NOT_CONFIGURED');
    } finally {
      await bare.close();
    }
  });
  await databaseFixture(11)(async (db) => {
    const f = await mountedApp(db, { storage: true });
    try {
      const conversation = await f.owner('POST', '/v2/attachment-conversations', {});
      assert.equal(conversation.statusCode, 201, conversation.body);
      const conversationId = conversation.json<{ conversationId: string }>().conversationId;
      const textOnly = await f.ready(
        { purpose: 'assistant_message', projectId: null, ticketId: null, conversationId },
        [],
      );
      const message = await f.owner('POST', '/v2/attachment-submissions/messages', {
        conversationId,
        clientMessageId: randomUUID(),
        text: 'xin chào',
        selection: textOnly,
        assistantRead: 'none',
      });
      assert.equal(message.statusCode, 201, message.body);
      const messageId = message.json<{ id: string }>().id;
      const messages = await f.get(`/v2/attachment-conversations/${conversationId}/messages`);
      assert.equal(messages.statusCode, 200, messages.body);
      assert.deepEqual(
        messages.json<{ items: { id: string }[] }>().items.map((m) => m.id),
        [messageId],
      );
      const route = await f.owner('POST', `/v2/attachment-messages/${messageId}/route`, {
        expectedInputRevision: '1',
        expectedRouteRevision: 0,
        decisionId: randomUUID(),
        ticket: inputTicket(f.base.project.id, 'request'),
      });
      assert.equal(route.statusCode, 503, route.body);
      assert.equal(route.json().error.code, 'INPUT_ROUTING_NOT_CONFIGURED');

      const { created } = await f.comment(f.base.a.id, [Buffer.from('no extractor')]);
      assert.equal(created.statusCode, 503, created.body);
      assert.equal(created.json().error.code, 'EXTRACTION_NOT_CONFIGURED');

      const machine = await f.owner('POST', '/v2/machines', { name: 'gateway' });
      assert.equal(machine.statusCode, 201, machine.body);
      const manifest = await f.app.inject({
        method: 'POST',
        url: '/v2/machine/attachment-manifests',
        payload: JSON.stringify({
          context: {
            projectId: f.base.project.id,
            ticketId: f.base.a.id,
            attemptId: randomUUID(),
            fence: '1',
            processInstanceId: randomUUID(),
            bindingRevision: 1,
          },
          decisionId: randomUUID(),
          required: [],
          inputRevision: '1',
          snapshotId: randomUUID(),
          snapshotSha256: '0'.repeat(64),
        }),
        headers: {
          authorization: `Bearer ${machine.json<{ token: string }>().token}`,
          'idempotency-key': randomUUID(),
          'content-type': 'application/json',
        },
      });
      assert.equal(manifest.statusCode, 409, manifest.body);
      assert.equal(manifest.json().error.code, 'INPUT_SERVICES_NOT_CONFIGURED');
    } finally {
      await f.close();
    }
  });
});

test('attachment mount: comment projection groups live refs by commentId in stable pages with ticket ACL', async () => {
  await databaseFixture(11)(async (db) => {
    const f = await mountedApp(db, { storage: true, extractorVersion: 'mount-test-extractor' });
    try {
      const first = await f.comment(f.base.a.id, [Buffer.from('một'), Buffer.from('hai')]);
      const second = await f.comment(f.base.a.id, [Buffer.from('ba')]);
      const sibling = await f.comment(f.base.b.id, [Buffer.from('bốn')]);
      const revoked = await f.comment(f.base.a.id, [Buffer.from('năm')]);
      for (const c of [first, second, sibling, revoked])
        assert.equal(c.created.statusCode, 201, c.created.body);
      const textOnly = await f.owner('POST', `/v2/tickets/${f.base.a.id}/comments`, { text: 'chỉ chữ' });
      assert.equal(textOnly.statusCode, 201, textOnly.body);
      const commentId = (c: typeof first) => c.created.json<{ comment: { id: string } }>().comment.id;
      await db`update attachment_links set revoked_at=now() where comment_id=${commentId(revoked)}`;

      const url = `/v2/tickets/${f.base.a.id}/attachments/by-comment`;
      const all = await f.get(url);
      assert.equal(all.statusCode, 200, all.body);
      const body = all.json<{
        items: { commentId: string; attachments: Ref[] }[];
        nextCursor: string | null;
      }>();
      const expected = [first, second].sort((x, y) => commentId(x).localeCompare(commentId(y)));
      assert.deepEqual(
        body.items.map((g) => [g.commentId, g.attachments.map((r) => r.attachmentId).sort()]),
        expected.map((c) => [commentId(c), [...c.selection.attachmentIds].sort()]),
      );
      for (const group of body.items) {
        const links = group.attachments.map((r) => r.linkId);
        assert.deepEqual(links, [...links].sort());
        for (const ref of group.attachments) {
          assert.equal(ref.ownerId, 'owner');
          assert.match(ref.sha256, /^[0-9a-f]{64}$/);
        }
      }
      assert.equal(body.nextCursor, null);
      assert.deepEqual((await f.get(url)).json(), body);

      const page1 = (await f.get(`${url}?limit=1`)).json<{
        items: { commentId: string }[];
        nextCursor: string;
      }>();
      assert.deepEqual(
        page1.items.map((g) => g.commentId),
        [body.items[0]?.commentId],
      );
      assert.equal(page1.nextCursor, body.items[0]?.commentId);
      const page2 = (await f.get(`${url}?limit=1&cursor=${page1.nextCursor}`)).json<{
        items: { commentId: string }[];
        nextCursor: string | null;
      }>();
      assert.deepEqual(
        page2.items.map((g) => g.commentId),
        [body.items[1]?.commentId],
      );
      assert.equal(page2.nextCursor, null);

      const siblingGroups = (await f.get(`/v2/tickets/${f.base.b.id}/attachments/by-comment`)).json<{
        items: { commentId: string }[];
      }>();
      assert.deepEqual(
        siblingGroups.items.map((g) => g.commentId),
        [commentId(sibling)],
      );

      assert.equal((await f.get(url, {})).statusCode, 401);
      assert.equal((await f.get(`${url}?limit=0`)).statusCode, 400);
      assert.equal((await f.get(`/v2/tickets/${randomUUID()}/attachments/by-comment`)).statusCode, 404);
      const machine = await f.owner('POST', '/v2/machines', { name: 'unbound' });
      assert.equal(machine.statusCode, 201, machine.body);
      const bearer = { authorization: `Bearer ${machine.json<{ token: string }>().token}` };
      assert.equal((await f.get(url, bearer)).statusCode, 404);
    } finally {
      await f.close();
    }
  });
});
