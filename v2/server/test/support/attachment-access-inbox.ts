import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readAssistantSession } from '../../src/attachments/grants.ts';
import { createMessageServices, type MessageDecisionAuthority } from '../../src/attachments/messages.ts';
import { createRoutingServices } from '../../src/attachments/routing.ts';
import { setSourceConfig } from '../../src/models/config.ts';
import type { Db } from '../../src/platform/contracts.ts';
import { ApiError } from '../../src/platform/errors.ts';
import { attachmentAccessFixture } from './attachment-access.ts';
import { assistantProtocolAuthority } from './attachment-access-authority.ts';
import { fixturePng, publishKnownRepresentation } from './attachment-access-publication.ts';
import { sha } from './attachments.ts';
import { inputTicket, owner } from './tickets.ts';
export async function admittedInboxFixture(db: Db, beforeDecision?: () => Promise<void>, routed = false) {
  const port = assistantProtocolAuthority();
  const decisionAuthority: MessageDecisionAuthority = async (tx, input, actor) => {
    const [receipt] =
      await tx`select session_id,coverage,trust from attachment_assistant_receipts where id=${input.receiptId}`;
    if (receipt?.coverage !== 'all_selected' || receipt.trust !== 'reported_transport')
      throw new ApiError('FORBIDDEN', 403, 'Thiếu receipt');
    const { session, grant } = await readAssistantSession(
      tx,
      actor,
      String(receipt.session_id),
      port.authority,
    );
    if (
      session.grantId !== input.grantId ||
      session.snapshotId !== input.snapshotId ||
      grant.target.kind !== 'message' ||
      grant.target.messageId !== input.messageId
    )
      throw new ApiError('FORBIDDEN', 403, 'Proof không khớp');
    await beforeDecision?.();
  };
  const f = await attachmentAccessFixture(db, { assistant: port.authority, decisionAuthority });
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
    const ref = { attachmentId: original.attachmentId, sha256: original.sha256, ownerId: 'owner' as const },
      extraction = await publishKnownRepresentation(f, ref);
    if (routed) {
      const service = createMessageServices({
        store: f.base.store,
        queuePolicy: { extractorVersion: 'protocol-fixture', configSha256: f.base.config.policySha256 },
        decisionAuthority,
      });
      const ticket = inputTicket(f.projects.A.id, 'request');
      const decision = await f.mutation((tx) =>
        service.persistMessageInputDecision(
          tx,
          {
            messageId: message.id,
            inputRevision: '2',
            snapshotId: null,
            grantId: null,
            receiptId: null,
            kind: 'routing',
            body: { ticket, expectedRouteRevision: 0 },
          },
          owner,
        ),
      );
      const router = createRoutingServices({
        authority: async (_tx, actor) => assert.deepEqual(actor, owner),
      });
      await f.mutation((tx) =>
        router.routeAssistantMessage(
          tx,
          {
            messageId: message.id,
            expectedInputRevision: '2',
            expectedRouteRevision: 0,
            decisionId: decision,
            ticket,
          },
          owner,
        ),
      );
    }
    const [authorization] =
      await db`select id from attachment_submission_authorizations where target_kind='message' and target_id=${message.id}`;
    const [revision] =
      await db`select revision from attachment_input_revisions where target_kind='message' and target_id=${message.id}`;
    const target = { kind: 'message' as const, messageId: message.id };
    const issueBody = { authorizationId: authorization.id, target, inputRevision: String(revision.revision) },
      issueKey = randomUUID();
    const granted = await f.ownerRequest('POST', '/v2/attachment-assistant-grants', issueBody, issueKey);
    assert.equal(granted.statusCode, 201, granted.body);
    const grant = granted.json();
    const snap = await f.machineRequest('A', 'POST', '/v2/input-snapshots', {
      target,
      access: { kind: 'assistant-grant', grantId: grant.id, designationRevision: grant.designationRevision },
      expectedInputRevision: null,
      scopeDecisionId: null,
    });
    assert.equal(snap.statusCode, 200, snap.body);
    const snapshot = snap.json();
    assert.equal(
      (
        await f.machineRequest('A', 'POST', `/v2/machine/assistant-input-grants/${grant.id}/bind-snapshot`, {
          snapshotId: snapshot.id,
        })
      ).statusCode,
      200,
    );
    const startBody = { grantId: grant.id, snapshotId: snapshot.id, modelSelectionId: randomUUID() };
    const start = await f.machineRequest('A', 'POST', '/v2/machine/assistant-input-sessions', startBody);
    assert.equal(start.statusCode, 201, start.body);
    const session = start.json();
    const derivative = extraction.derivatives[0];
    assert.ok(derivative);
    const saved = await f.machineRequest('A', 'POST', '/v2/machine/assistant-input-read-receipts', {
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
      transportEvidenceSha256: sha(fixturePng),
    });
    assert.equal(saved.statusCode, 201, saved.body);
    const reply = {
      messageId: message.id,
      inputRevision: snapshot.inputRevision,
      snapshotId: snapshot.id,
      grantId: grant.id,
      receiptId: saved.json().receiptId,
      kind: 'reply' as const,
      body: { text: 'Protocol fixture reply' },
    };
    return {
      ...f,
      port,
      original: ref,
      extraction,
      message,
      grant,
      issueBody,
      issueKey,
      snapshot,
      session,
      startBody,
      reply,
      decisionAuthority,
      messages: createMessageServices({
        store: f.base.store,
        queuePolicy: { extractorVersion: 'protocol-fixture', configSha256: f.base.config.policySha256 },
        decisionAuthority,
      }),
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}
