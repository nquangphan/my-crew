import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { attachmentAccessFixture } from './support/attachment-access.ts';
import { sha } from './support/attachments.ts';
import { databaseFixture } from './support/db.ts';

test('attachment routes raw upload, CSRF, strict schema, metered replay and private responses', async () => {
  await databaseFixture(10)(async (db) => {
    const f = await attachmentAccessFixture(db);
    try {
      const compose = await f.ownerRequest('POST', '/v2/attachment-compose', {
        purpose: 'ticket',
        projectId: f.projects.A.id,
        ticketId: null,
      });
      assert.equal(compose.statusCode, 201, compose.body);
      const id = compose.json<{ id: string }>().id;
      const bytes = Buffer.from('raw\nbytes');
      const reserveBody = {
        expectedRevision: 1,
        fileName: 'hello.txt',
        declaredMime: 'text/plain',
        byteLength: bytes.length,
        sha256: sha(bytes),
      };
      const key = randomUUID();
      const reserve = await f.ownerRequest('POST', `/v2/attachment-compose/${id}/uploads`, reserveBody, key);
      assert.equal(reserve.statusCode, 201, reserve.body);
      assert.deepEqual(
        (await f.ownerRequest('POST', `/v2/attachment-compose/${id}/uploads`, reserveBody, key)).json(),
        reserve.json(),
      );
      assert.equal(
        (
          await f.ownerRequest('POST', `/v2/attachment-compose/${id}/uploads`, {
            ...reserveBody,
            storageKey: '/tmp/private',
          })
        ).statusCode,
        400,
      );
      const attachmentId = reserve.json<{ attachment: { attachmentId: string } }>().attachment.attachmentId;
      const upload = () =>
        f.app.inject({
          method: 'PUT',
          url: `/v2/attachment-uploads/${attachmentId}/content`,
          payload: bytes,
          headers: { ...f.ownerHeaders, 'content-type': 'application/octet-stream' },
        });
      assert.equal((await upload()).statusCode, 201);
      assert.equal((await upload()).statusCode, 200);
      const wrongMime = await f.app.inject({
        method: 'PUT',
        url: `/v2/attachment-uploads/${attachmentId}/content`,
        payload: 'not a byte stream',
        headers: { ...f.ownerHeaders, 'content-type': 'text/plain' },
      });
      assert.equal(wrongMime.statusCode, 415, wrongMime.body);
      const oversized = await f.ownerRequest('POST', `/v2/attachment-compose/${id}/uploads`, {
        ...reserveBody,
        expectedRevision: reserve.json().selectionRevision,
        byteLength: f.base.config.maxFileBytes + 1,
      });
      assert.equal(oversized.statusCode, 413, oversized.body);
      const publicHash = await f.app.inject({
        method: 'GET',
        url: `/v2/attachments/by-sha256/${sha(bytes)}/content`,
        headers: { cookie: f.cookie },
      });
      assert.equal(publicHash.statusCode, 404);

      const mismatch = await f.app.inject({
        method: 'PUT',
        url: `/v2/attachment-uploads/${attachmentId}/content`,
        payload: Buffer.from('bad'),
        headers: { ...f.ownerHeaders, 'content-type': 'application/octet-stream' },
      });
      assert.equal(mismatch.statusCode, 409, mismatch.body);
      const csrf = await f.app.inject({
        method: 'PUT',
        url: `/v2/attachment-uploads/${attachmentId}/content`,
        payload: bytes,
        headers: {
          cookie: f.cookie,
          origin: f.options.publicOrigin,
          'content-type': 'application/octet-stream',
        },
      });
      assert.equal(csrf.statusCode, 403);
      const owner = await f.app.inject({
        method: 'GET',
        url: `/v2/attachments/${attachmentId}/content`,
        headers: { cookie: f.cookie },
      });
      assert.equal(owner.statusCode, 200, owner.body);
      assert.equal(owner.body, bytes.toString());
      assert.equal(owner.headers['cache-control'], 'private, no-store');
      assert.equal(owner.headers['x-content-type-options'], 'nosniff');
      assert.equal(owner.headers['content-length'], String(bytes.length));
      assert.match(String(owner.headers['content-disposition']), /^attachment;/);
      assert.equal((await f.machineDownload('A', attachmentId)).statusCode, 404);
      assert.equal(
        (
          await f.app.inject({
            method: 'GET',
            url: `/v2/attachments/${attachmentId}/content`,
            headers: { authorization: `Bearer ${f.machines.A.token}` },
          })
        ).statusCode,
        403,
      );
      const ranges = await f.app.inject({
        method: 'GET',
        url: `/v2/attachments/${attachmentId}/content`,
        headers: { cookie: f.cookie, range: 'bytes=0-1' },
      });
      assert.equal(ranges.statusCode, 416);
      const policy = await f.app.inject({
        method: 'GET',
        url: '/v2/attachment-policy',
        headers: { cookie: f.cookie },
      });
      assert.equal(policy.statusCode, 200);
      assert.ok(!policy.body.includes(f.base.root));
      const manifest = await f.machineRequest('A', 'POST', '/v2/machine/attachment-manifests', {
        context: f.contexts.A,
        decisionId: randomUUID(),
        required: [],
        inputRevision: '1',
        snapshotId: randomUUID(),
        snapshotSha256: '0'.repeat(64),
      });
      assert.equal(manifest.statusCode, 409, manifest.body);
      assert.equal(manifest.json().error.code, 'INPUT_SERVICES_NOT_CONFIGURED');
    } finally {
      await f.close();
    }
  });
});

test('attachment routes authenticate again before conditional replies and current attempt downloads', async () => {
  await databaseFixture(10)(async (db) => {
    const f = await attachmentAccessFixture(db);
    try {
      const a = await f.linkFile('A', Buffer.from('current'));
      const first = await f.machineDownload('A', a.attachmentId);
      assert.equal(first.statusCode, 200, first.body);
      const url = `/v2/machine/attachments/${a.attachmentId}/content?${new URLSearchParams(Object.entries(f.contexts.A).map(([k, v]) => [k, String(v)]))}`;
      const wrong = await f.app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${f.machines.A.token}`, 'if-match': `"${'0'.repeat(64)}"` },
      });
      assert.equal(wrong.statusCode, 412);
      const fresh = await f.app.inject({
        method: 'GET',
        url,
        headers: {
          authorization: `Bearer ${f.machines.A.token}`,
          'if-none-match': String(first.headers.etag),
        },
      });
      assert.equal(fresh.statusCode, 304);
      await db`update machines set revoked_at=now() where id=${f.machines.A.machineId}`;
      const revoked = await f.app.inject({
        method: 'GET',
        url,
        headers: {
          authorization: `Bearer ${f.machines.A.token}`,
          'if-none-match': String(first.headers.etag),
        },
      });
      assert.equal(revoked.statusCode, 401);
    } finally {
      await f.close();
    }
  });
});

test('attachment routes revoke between real streamed chunks and reject next request', async () => {
  await databaseFixture(10)(async (db) => {
    const f = await attachmentAccessFixture(db);
    let release = () => {};
    let pending: Promise<unknown> | undefined;
    const realOpen = f.base.store.open.bind(f.base.store);
    try {
      const original = await f.linkFile('A', Buffer.alloc(3 * 65536, 65));
      let reached = () => {};
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const waiting = new Promise<void>((resolve) => {
        reached = resolve;
      });
      f.base.store.open = async (blob) => {
        const stream = await realOpen(blob);
        return (async function* () {
          let first = true;
          for await (const chunk of stream) {
            if (!first) {
              reached();
              await barrier;
            }
            first = false;
            yield chunk;
          }
        })();
      };
      const url = await f.app.listen({ host: '127.0.0.1', port: 0 });
      console.info(
        `attachment access listener pid=${process.pid} argv=${JSON.stringify(process.argv)} url=${url}`,
      );
      const path = `/v2/machine/attachments/${original.attachmentId}/content?${new URLSearchParams(Object.entries(f.contexts.A).map(([k, v]) => [k, String(v)]))}`;
      const response = await fetch(url + path, {
        headers: { authorization: `Bearer ${f.machines.A.token}` },
      });
      assert.equal(response.status, 200);
      assert.ok(response.body);
      const reader = response.body.getReader();
      const first = await reader.read();
      assert.equal(first.done, false);
      let delivered = first.value?.byteLength ?? 0;
      assert.ok(delivered > 0);
      await waiting;
      await db`update machines set revoked_at=now() where id=${f.machines.A.machineId}`;
      release();
      pending = (async () => {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          delivered += next.value.byteLength;
        }
      })();
      await assert.rejects(pending);
      assert.ok(delivered <= 65536, `received ${delivered} bytes after cutoff`);
      const next = await fetch(url + path, { headers: { authorization: `Bearer ${f.machines.A.token}` } });
      assert.equal(next.status, 401);
    } finally {
      release();
      if (pending) await pending.catch(() => {});
      f.base.store.open = realOpen;
      await f.close();
    }
  });
});
