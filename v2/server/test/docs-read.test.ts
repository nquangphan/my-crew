import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { hashBytes } from '../src/docs/checksum.ts';
import { databaseFixture } from './support/db.ts';
import { legacyBundle, rehashBundle, validDocs } from './support/docs.ts';
import { pin } from './support/execution.ts';
import { apiFixture } from './support/http.ts';

const withDatabase = databaseFixture(6);

test('docs tìm kiếm Unicode original bytes audit labels and actor permissions', async () =>
  withDatabase(async (db) => {
    const f = await apiFixture(db);
    try {
      const original = Buffer.from('# Tài liệu\r\nKết nối máy Mac\0 cuối');
      const imported = await f.import(
        legacyBundle({
          'docs/index.md': original,
          'docs/superpowers/plans/sample.md': Buffer.from('# Kết nối artifact'),
        }),
      );
      const p = imported.projects[0]!;
      const search = await f.ownerGet(
        `/v2/docs/search?q=${encodeURIComponent('Kết nối')}&projectId=${p.projectId}`,
      );
      assert.equal(search.statusCode, 200, search.text);
      const items = search.json<{ items: { auditState: string; contentClass: string }[] }>().items;
      assert.equal(items.length, 2);
      assert(items.every((item) => item.auditState === 'invalid'));
      assert(items.some((item) => item.contentClass === 'workflow_artifact'));
      const page = await f.ownerGet(`/v2/projects/${p.projectId}/docs/page?path=docs%2Findex.md`);
      assert.equal(page.statusCode, 200, page.text);
      assert.equal(page.json().text, original.toString('utf8'));
      assert.equal(page.json().sha256, hashBytes(original));
      assert.equal(page.json().sourceCommit, null);
      assert.equal((await f.ownerGet(`/v2/projects/${p.projectId}`)).json().docsState, 'invalid');
      const other = await f.ownerPost('/v2/machines', { name: 'other' });
      const token = other.json<{ token: string }>().token;
      assert.equal((await f.machineGet(`/v2/projects/${p.projectId}/docs/tree`, token)).statusCode, 404);
      assert.equal(
        (await f.machineGet('/v2/docs/search?q=Kết', token)).json<{ items: unknown[] }>().items.length,
        0,
      );
      assert.equal(
        (await f.ownerGet(`/v2/projects/${p.projectId}/docs/page?path=../secret`)).statusCode,
        400,
      );
      assert.equal(
        (await f.ownerGet(`/v2/projects/${p.projectId}/docs/tree?snapshotId=${randomUUID()}`)).statusCode,
        404,
      );
      for (const query of ['q=', 'q=x&limit=101', 'q=x&unknown=y', `q=${'x'.repeat(257)}`])
        assert.equal((await f.ownerGet(`/v2/docs/search?${query}`)).statusCode, 400);
      assert.equal(
        (await f.ownerGet('/v2/docs/search?q=%27%3Bdrop%20table%20docs_files%3B--')).statusCode,
        200,
      );
      const nul = await f.ownerGet(`/v2/docs/search?q=${encodeURIComponent('\0 cuối')}`);
      assert.equal(nul.json<{ items: unknown[] }>().items.length, 1);
    } finally {
      await f.close();
    }
  }));

test('search full literal fallback beyond GIN prefix, escaped wildcard and scoped tie-safe cursor', async () =>
  withDatabase(async (db) => {
    const f = await apiFixture(db);
    try {
      const files = {
        ...validDocs(),
        'docs/flows/tail.md': Buffer.from(`${'z '.repeat(5000)}\nKết nối TailNeedle 100% _literal\\end`),
        'docs/flows/second.md': Buffer.from('# TailNeedle second'),
        'docs/flows/tied.md': Buffer.from(`${'z '.repeat(5000)}\nTailNeedle tied zero rank`),
      };
      const bundle = legacyBundle(files);
      const p = (await f.import(bundle)).projects[0]!;
      assert.equal(
        (await f.ownerGet('/v2/docs/search?q=TailNeedle')).json<{ items: unknown[] }>().items.length,
        3,
      );
      for (const q of ['100%', '_literal', '\\end'])
        assert.equal(
          (await f.ownerGet(`/v2/docs/search?q=${encodeURIComponent(q)}`)).json<{ items: unknown[] }>().items
            .length,
          1,
        );
      const first = (await f.ownerGet('/v2/docs/search?q=TailNeedle&limit=1')).json<{
        items: { path: string }[];
        nextCursor: string;
      }>();
      const second = (
        await f.ownerGet(`/v2/docs/search?q=TailNeedle&limit=1&after=${first.nextCursor}`)
      ).json<{ items: { path: string }[]; nextCursor: string | null }>();
      assert.equal(second.items.length, 1);
      assert.notEqual(first.items[0]!.path, second.items[0]!.path);
      assert(second.nextCursor);
      const third = (
        await f.ownerGet(`/v2/docs/search?q=TailNeedle&limit=1&after=${second.nextCursor}`)
      ).json<{ items: { path: string }[]; nextCursor: string | null }>();
      assert.equal(third.items.length, 1);
      assert.equal(new Set([first.items[0]!.path, second.items[0]!.path, third.items[0]!.path]).size, 3);
      assert.equal(third.nextCursor, null);
      assert.equal((await f.ownerGet(`/v2/docs/search?q=other&after=${first.nextCursor}`)).statusCode, 400);
      assert.equal(
        (await f.ownerGet(`/v2/docs/search?q=TailNeedle&projectId=${p.projectId}&after=${first.nextCursor}`))
          .statusCode,
        400,
      );
      const next = legacyBundle({ 'docs/index.md': Buffer.from('# New snapshot') });
      next.inventory[0]!.legacyProjectId = 'legacy-1';
      await f.import(rehashBundle(next));
      assert.equal(
        (await f.ownerGet('/v2/docs/search?q=TailNeedle')).json<{ items: unknown[] }>().items.length,
        0,
      );
      assert.equal(
        (await f.ownerGet(`/v2/docs/search?q=TailNeedle&snapshotId=${p.snapshotId}`)).json<{
          items: unknown[];
        }>().items.length,
        3,
      );
    } finally {
      await f.close();
    }
  }));

test('docs tree links composite ticket references and verified mixed standard-page completion reader', async () =>
  withDatabase(async (db) => {
    const { docsCompletionReader, readProjectDocsState } = await import('../src/docs/read.ts');
    const { readCompletionFacts } = await import('../src/tickets/completion.ts');
    const f = await apiFixture(db, { authority: { authorizeDispatch: async () => {} } });
    try {
      const imported = await f.import(
        legacyBundle({
          ...validDocs(),
          'docs/superpowers/plans/design.md': Buffer.from('# Thiết kế\n[Index](../../index.md)'),
        }),
      );
      const p = imported.projects[0]!;
      const response = await f.ownerPost('/v2/tickets', {
        projectId: p.projectId,
        parentId: null,
        level: 'request',
        kind: 'code',
        title: 'Code completion',
        description: '',
        mandatory: true,
        criteria: {},
        inputs: {},
        outputs: {},
        skill: null,
        workflowPin: pin,
      });
      assert.equal(response.statusCode, 201, response.text);
      const root = response.json<import('../src/tickets/contracts.ts').Ticket>();
      const linked = await f.ownerPut(`/v2/tickets/${root.id}/docs-links`, {
        snapshotId: p.snapshotId,
        paths: ['docs/index.md'],
        expectedRevision: root.revision,
      });
      assert.equal(linked.statusCode, 200, linked.text);
      const page = (await f.ownerGet(`/v2/projects/${p.projectId}/docs/page?path=docs/index.md`)).json<{
        relatedTicketIds: string[];
      }>();
      assert.deepEqual(page.relatedTicketIds, [root.id]);
      const tree = (await f.ownerGet(`/v2/projects/${p.projectId}/docs/tree`)).json<{
        contentClass: string;
        pages: { path: string; parentPath: string | null; contentClass: string }[];
        links: unknown[];
      }>();
      assert.equal(tree.contentClass, 'mixed');
      assert.equal(
        tree.pages.find((page) => page.path === 'docs/flows/sample.md')?.parentPath,
        'docs/index.md',
      );
      assert.equal(
        tree.pages.find((page) => page.path === 'docs/superpowers/plans/design.md')?.contentClass,
        'workflow_artifact',
      );
      assert.equal(tree.links.length > 0, true);
      const second = legacyBundle(validDocs());
      second.inventory[0]!.legacyProjectId = 'legacy-2';
      second.inventory[0]!.key = 'OTHER';
      const foreign = (await f.import(rehashBundle(second))).projects[0]!;
      assert.equal(
        (await f.ownerGet(`/v2/projects/${p.projectId}/docs/tree?snapshotId=${foreign.snapshotId}`))
          .statusCode,
        404,
      );
      assert.equal(
        (
          await f.ownerGet(
            `/v2/docs/search?q=Luồng&projectId=${p.projectId}&snapshotId=${foreign.snapshotId}`,
          )
        ).statusCode,
        404,
      );
      const machine = (await f.ownerPost('/v2/machines', { name: 'Reader fixture' })).json<{
        machine: { id: string };
        token: string;
      }>();
      assert.equal(
        (
          await f.ownerPut(`/v2/projects/${p.projectId}/binding`, {
            machineId: machine.machine.id,
            checkoutPath: '/tmp/docs-reader',
            expectedRevision: 1,
          })
        ).statusCode,
        200,
      );
      const ready = (
        await f.ownerPost(`/v2/tickets/${root.id}/signals`, {
          signal: 'dependencies_ready',
          expectedRevision: 2,
        })
      ).json<{ revision: number }>();
      const command = (
        await f.ownerPost('/v2/commands', {
          machineId: machine.machine.id,
          ticketId: root.id,
          type: 'start',
          payload: {},
        })
      ).json<{ id: string }>();
      const attemptResponse = await f.machineWrite(
        `/v2/machine/commands/${command.id}/claim`,
        machine.token,
        {
          processInstanceId: randomUUID(),
          permit: {
            commandId: command.id,
            ticketId: root.id,
            machineId: machine.machine.id,
            bindingRevision: 2,
            ticketRevision: ready.revision,
            workflow: pin,
            checkedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 25000).toISOString(),
            telemetryId: randomUUID(),
            decisionId: randomUUID(),
          },
        },
      );
      assert.equal(attemptResponse.statusCode, 201, attemptResponse.text);
      const attemptId = attemptResponse.json<{ id: string }>().id;
      const commit = 'a'.repeat(40);
      await db`insert into evidence(id,ticket_id,kind,data) values(${randomUUID()},${root.id},'code_result',${db.json({ verification: 'verified', testAuthority: 'Task7' })}),(${randomUUID()},${root.id},'merge',${db.json({ verification: 'verified', commit, testAuthority: 'Task7' })})`;
      const facts = await db.begin((tx) => readCompletionFacts(tx, root, docsCompletionReader));
      assert.equal(facts.ready, false);
      assert.equal(facts.docsCommit, null);
      // Future attestation fixture: a new immutable snapshot, never promotion of imported rows.
      const verified = randomUUID();
      await db`insert into docs_snapshots(id,project_id,source_commit,snapshot_sha,source_kind,audit_state,audit_report,content_class) values(${verified},${p.projectId},${commit},${'c'.repeat(64)},'checkout_sync','verified',${db.json({ testAuthority: 'Task7 only; Phase08 production unavailable' })},'mixed')`;
      await db`insert into docs_files(snapshot_id,path,content_class,bytes,sha,title,search_text) select ${verified},path,content_class,bytes,sha,title,search_text from docs_files where snapshot_id=${p.snapshotId}`;
      await db`update projects set latest_verified_snapshot_id=${verified},expected_commit=${commit} where id=${p.projectId}`;
      assert.equal(await readProjectDocsState(db, p.projectId), 'current');
      await db`update projects set expected_commit=null where id=${p.projectId}`;
      assert.equal(await readProjectDocsState(db, p.projectId), 'stale');
      await db`update projects set expected_commit=${'b'.repeat(40)} where id=${p.projectId}`;
      assert.equal(await readProjectDocsState(db, p.projectId), 'stale');
      assert.equal(await db.begin((tx) => docsCompletionReader(tx, p.projectId, commit)), null); // no trusted same-commit receipt
      await db`update projects set expected_commit=${commit} where id=${p.projectId}`;
      await db`insert into docs_sync_receipts(attempt_id,merged_commit,snapshot_id,input_sha256) values(${attemptId},${commit},${verified},${'d'.repeat(64)})`;
      assert.equal(await db.begin((tx) => docsCompletionReader(tx, p.projectId, commit)), commit);
      assert.equal((await db.begin((tx) => readCompletionFacts(tx, root, docsCompletionReader))).ready, true);
      const visible = (await f.ownerGet(`/v2/projects/${p.projectId}/docs/tree`)).json<{
        auditState: string;
      }>();
      assert.equal(visible.auditState, 'verified');
    } finally {
      await f.close();
    }
  }));
