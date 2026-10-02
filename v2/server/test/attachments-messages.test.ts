import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { attachmentFixture, sha } from './support/attachments.ts';
import { databaseFixture } from './support/db.ts';
import { owner } from './support/tickets.ts';

test('attachment inbox concurrent client UUID across two text-only composes returns one immutable receipt', async () =>
  databaseFixture(10)(async (db) => {
    const f = await attachmentFixture(db);
    try {
      const { createMessageServices } = await import('../src/attachments/messages.ts');
      const s = createMessageServices({ store: f.store, now: f.clock.now });
      const c = await f.mutation(randomUUID(), (tx) => s.createConversation(tx, owner));
      const target = {
        purpose: 'assistant_message' as const,
        projectId: null,
        ticketId: null,
        conversationId: c.id,
      };
      const selections = await Promise.all([0, 1].map(() => f.readyCompose(target, [])));
      const clientMessageId = randomUUID();
      const results = await Promise.all(
        selections.map((selection) =>
          f.mutation(randomUUID(), (tx) =>
            s.submitAssistantMessage(
              tx,
              { conversationId: c.id, clientMessageId, text: 'Nội dung', selection, assistantRead: 'none' },
              owner,
            ),
          ),
        ),
      );
      assert.deepEqual(results[0], results[1]);
      assert.equal((await db`select * from attachment_messages`).length, 1);
      assert.equal((await db`select * from events where type='assistant.message.created'`).length, 1);
      assert.equal((await db`select * from attachment_submissions`).length, 1);
      assert.equal((await db`select * from attachment_compose_sessions where state='open'`).length, 1);
      await assert.rejects(
        db`update attachment_messages set text='Changed bytes' where id=${results[0].id}`,
        /ATTACHMENT_RECORD_IMMUTABLE/,
      );
    } finally {
      await f.close();
    }
  }));
test('attachment message decisions default deny future scope reply and machine proof; stale owner route decision rejects', async () =>
  databaseFixture(10)(async (db) => {
    const f = await attachmentFixture(db);
    try {
      const { createMessageServices } = await import('../src/attachments/messages.ts');
      const s = createMessageServices({ store: f.store });
      const c = await f.mutation(randomUUID(), (tx) => s.createConversation(tx, owner));
      const selection = await f.readyCompose(
        { purpose: 'assistant_message', projectId: null, ticketId: null, conversationId: c.id },
        [],
      );
      const message = await f.mutation(randomUUID(), (tx) =>
        s.submitAssistantMessage(
          tx,
          {
            conversationId: c.id,
            clientMessageId: randomUUID(),
            text: 'Text',
            selection,
            assistantRead: 'none',
          },
          owner,
        ),
      );
      const base = {
        messageId: message.id,
        inputRevision: '1',
        snapshotId: null,
        grantId: null,
        receiptId: null,
        body: { rationale: 'fixture' },
      };
      for (const kind of ['scope', 'reply'] as const)
        await assert.rejects(
          f.mutation(randomUUID(), (tx) => s.persistMessageInputDecision(tx, { ...base, kind }, owner)),
          { code: 'INPUT_DECISION_NOT_CONFIGURED' },
        );
      await assert.rejects(
        f.mutation(randomUUID(), (tx) =>
          s.persistMessageInputDecision(
            tx,
            { ...base, kind: 'routing' },
            { kind: 'machine', id: randomUUID() },
          ),
        ),
        { code: 'INPUT_DECISION_NOT_CONFIGURED' },
      );
      await assert.rejects(
        f.mutation(randomUUID(), (tx) =>
          s.persistMessageInputDecision(tx, { ...base, inputRevision: '2', kind: 'routing' }, owner),
        ),
        { code: 'INPUT_SNAPSHOT_STALE' },
      );
      assert.equal((await db`select * from attachment_message_decisions`).length, 0);
      assert.equal((await db`select * from attachment_assistant_sessions`).length, 0);
    } finally {
      await f.close();
    }
  }));

test('attachment inbox canonical retry creates one owner-only message with retained originals and no ticket', async () =>
  databaseFixture(10)(async (db) => {
    const f = await attachmentFixture(db);
    try {
      const { createMessageServices } = await import('../src/attachments/messages.ts');
      const s = createMessageServices({
        store: f.store,
        now: f.clock.now,
        queuePolicy: {
          extractorVersion: 'fixture-pending-only',
          configSha256: sha(Buffer.from('fixture protocol')),
        },
      });
      const key = randomUUID();
      const conversation = await f.mutationWith(key, {}, (tx) => s.createConversation(tx, owner));
      assert.deepEqual(await f.mutationWith(key, {}, (tx) => s.createConversation(tx, owner)), conversation);
      const selection = await f.readyCompose(
        { purpose: 'assistant_message', projectId: null, ticketId: null, conversationId: conversation.id },
        [Buffer.from('A')],
      );
      const input = {
        conversationId: conversation.id,
        clientMessageId: randomUUID(),
        text: '',
        selection,
        assistantRead: 'selected-inputs' as const,
      };
      const before = (await db`select id from tickets`).length;
      const response = await f.mutationAs(
        randomUUID(),
        input,
        owner,
        { conversationId: conversation.id },
        (tx) => s.submitAssistantMessage(tx, input, owner),
      );
      assert.deepEqual(
        await f.mutationAs(randomUUID(), input, owner, { conversationId: conversation.id }, (tx) =>
          s.submitAssistantMessage(tx, input, owner),
        ),
        response,
      );
      const other = await f.readyCompose(
        { purpose: 'assistant_message', projectId: null, ticketId: null, conversationId: conversation.id },
        [],
      );
      assert.deepEqual(
        await f.mutation(randomUUID(), (tx) =>
          s.submitAssistantMessage(
            tx,
            { ...input, selection: { ...other, attachmentIds: selection.attachmentIds } },
            owner,
          ),
        ),
        response,
      );
      await assert.rejects(
        f.mutation(randomUUID(), (tx) => s.submitAssistantMessage(tx, { ...input, text: 'changed' }, owner)),
        { code: 'COMPOSE_ALREADY_SUBMITTED' },
      );
      await assert.rejects(
        f.mutation(randomUUID(), (tx) =>
          s.submitAssistantMessage(
            tx,
            { ...input, text: 'changed', selection: { ...other, attachmentIds: selection.attachmentIds } },
            owner,
          ),
        ),
        { code: 'MESSAGE_ALREADY_SUBMITTED' },
      );
      await assert.rejects(
        f.mutation(randomUUID(), (tx) =>
          s.submitAssistantMessage(tx, { ...input, assistantRead: 'none' }, owner),
        ),
        { code: 'COMPOSE_ALREADY_SUBMITTED' },
      );
      assert.equal((await db`select id from tickets`).length, before);
      assert.equal((await db`select * from attachment_messages`).length, 1);
      assert.equal((await db`select * from attachment_message_links`).length, 1);
      assert.equal((await db`select * from attachment_submission_authorizations`).length, 1);
      const [event] = await db`select * from events where type='assistant.message.created'`;
      assert.deepEqual(event.data, { messageId: response.id, inputRevision: '1' });
      assert.equal(event.project_id, null);
      assert.equal(event.ticket_id, null);
      assert.equal(event.audience_machine_id, null);
      assert.equal((await db`select * from attachment_assistant_grants`).length, 0);
      await assert.rejects(
        f.mutationAs(
          randomUUID(),
          input,
          { kind: 'machine', id: randomUUID() },
          { conversationId: conversation.id },
          (tx) => s.submitAssistantMessage(tx, input, owner),
        ),
        { code: 'FORBIDDEN' },
      );
    } finally {
      await f.close();
    }
  }));
