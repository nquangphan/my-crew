import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { loadAttachmentConfig } from '../../server/src/attachments/config.ts';
import { connectDb } from '../../server/src/db/client.ts';
import { withFixture } from '../e2e/support/fixture.ts';
import { seedOwnerTicket } from '../e2e/support/owner-seed.ts';
import { createFixtureReceivers } from '../scripts/e2e-attachment-receivers.ts';

// Real API + PostgreSQL of the fixture. On a non-Linux host the fixture serves uploads through the in-process
// closed-ACK port, so this run proves its register → run → closeAndAcknowledge → proveStopped protocol; on
// Linux the same run goes through the native registry, and the port is exercised directly below.
test('upload qua API thật đóng receiver bằng closed-ACK, và port fixture chạy trọn giao thức', async () => {
  await withFixture(async (crew) => {
    const seeded = await seedOwnerTicket(crew, 'Ticket kiểm upload');
    const login = await fetch(`${crew.apiOrigin}/v2/auth/session`, {
      method: 'POST',
      headers: { origin: crew.webOrigin, 'content-type': 'application/json' },
      body: JSON.stringify({ password: crew.ownerPassword }),
    });
    const cookie = login.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
    const { csrfToken } = (await login.json()) as { csrfToken: string };
    const headers = { origin: crew.webOrigin, cookie, 'x-csrf-token': csrfToken };
    const json = async (method: string, path: string, body: unknown) => {
      const response = await fetch(`${crew.apiOrigin}${path}`, {
        method,
        headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': randomUUID() },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: (await response.json()) as Record<string, any> };
    };
    const reserve = async (bytes: Buffer, name: string) => {
      const compose = await json('POST', '/v2/attachment-compose', {
        purpose: 'comment',
        projectId: seeded.projectId,
        ticketId: seeded.ticketId,
      });
      assert.equal(compose.status, 201, JSON.stringify(compose.body));
      const reserved = await json('POST', `/v2/attachment-compose/${compose.body.id}/uploads`, {
        expectedRevision: compose.body.revision,
        fileName: name,
        declaredMime: 'text/plain',
        byteLength: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
      assert.equal(reserved.status, 201, JSON.stringify(reserved.body));
      return reserved.body.attachment.attachmentId as string;
    };

    const db = connectDb(`postgres://postgres@127.0.0.1:${crew.dbPort}/${crew.dbName}`);
    try {
      const bytes = Buffer.from('nội dung tệp thử');
      const attachmentId = await reserve(bytes, 'thử.txt');
      const put = await fetch(`${crew.apiOrigin}/v2/attachment-uploads/${attachmentId}/content`, {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/octet-stream' },
        body: bytes,
      });
      assert.equal(put.status, 201, await put.text());
      const [receiver] =
        await db`select r.state, r.stop_proof, w.linux_boot_id from attachment_receivers r join attachment_server_writers w on w.instance_id=r.instance_id where r.attachment_id=${attachmentId}`;
      assert.equal(receiver?.state, 'closed');
      assert.ok(receiver?.stop_proof, 'Receiver phải có proof closed-ACK');
      assert.equal(
        receiver?.linux_boot_id === 'fixture-only',
        process.platform !== 'linux',
        'Non-Linux phải đi qua port fixture; Linux phải dùng writer native',
      );

      // The port itself, driven directly on the fixture database.
      const root = loadAttachmentConfig({
        CREW_V2_ATTACHMENT_STORAGE_ROOT:
          crew.resources.find(
            (resource) => resource.kind === 'scratch' && resource.id.includes('crew-v2-web-attachments-'),
          )?.id ?? '',
      }).storageRoot;
      const port = createFixtureReceivers({ db, root, storageHostId: randomUUID(), now: () => new Date() });
      const second = await reserve(Buffer.from('tệp thứ hai'), 'hai.txt');
      const registration = await db.begin((tx) => port.register(tx, second, '1'));
      assert.equal(await port.proveStopped(registration.id), null, 'Chưa đóng thì chưa có proof');
      await assert.rejects(port.closeAndAcknowledge(registration.id), /FIXTURE_WRITER_STILL_ACTIVE/);
      const ran = await port.control.run(registration.id, new AbortController().signal, async () => 'done');
      assert.equal(ran, 'done');
      const proof = await port.closeAndAcknowledge(registration.id);
      assert.equal(proof.kind, 'closed-ack');
      assert.equal(proof.receiverId, registration.id);
      assert.deepEqual(await port.proveStopped(registration.id), proof);
      assert.deepEqual(await port.closeAndAcknowledge(registration.id), proof, 'Đóng lặp trả đúng proof cũ');
      const [row] =
        await db`select state, closed_ack_sha256 from attachment_receivers where id=${registration.id}`;
      assert.equal(row?.state, 'closed');
      assert.equal(row?.closed_ack_sha256, proof.proofSha256);
      await assert.rejects(
        port.control.run(registration.id, new AbortController().signal, async () => 'again'),
        /FIXTURE_OPERATION_INVALID/,
      );
      assert.equal(await port.proveStopped(randomUUID()), null);
    } finally {
      await db.end({ timeout: 2 });
    }
  });
});
