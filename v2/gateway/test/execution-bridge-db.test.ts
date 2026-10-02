import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../../server/src/app.ts';
import { ApiError } from '../../server/src/platform/errors.ts';
import { databaseFixture } from '../../server/test/support/db.ts';
import { gatewayFixture, selectionAuthorityFixture } from '../../server/test/support/gateway.ts';
import { ticketFixture } from '../../server/test/support/tickets.ts';
import { toDomainPin } from '../src/commands/contracts.ts';
import { machineTransport } from '../src/commands/http-client.ts';
import { TicketCommandBridge } from '../src/execution/ticket-command-bridge.ts';
import { HttpOperationJournal } from '../src/journal/http-operations.ts';
import { GatewaySync } from '../src/sync/gateway-sync.ts';
import { bridgeRoot, workflowFixture } from './support/bridge-fixture.ts';

const withDb = databaseFixture(8);
console.log('Task5 private database container', process.env.CREW_V2_TEST_CONTAINER_ID);

test('execution bridge DB-backed selection, lost result/finalize and genuine retirement preserve guard', () =>
  withDb(async (db) => {
    const owned = await bridgeRoot(),
      w = await workflowFixture(owned.root),
      authority = await selectionAuthorityFixture(db);
    const initial = await gatewayFixture(db, authority);
    let server = { close: initial.close };
    let machine = machineTransport(initial.url, initial.token);
    let drop: string | null = null;
    const sent: any[] = [];
    const http = await HttpOperationJournal.open(owned.root, async (req) => {
      sent.push(structuredClone(req));
      const result = await machine.write(req);
      if (req.phase === drop && result.status < 300) {
        drop = null;
        throw new Error('LOST_REPLY');
      }
      return result;
    });
    let sync: GatewaySync | undefined, bridge: TicketCommandBridge | undefined;
    try {
      const bootId = randomUUID();
      const boot = await initial.machine.post('/v2/gateway/boots', { bootId, previousGeneration: '0' });
      assert.equal(boot.statusCode, 200, boot.text);
      const generation = boot.json<any>().bootGeneration;
      const config = await initial.owner.put(`/v2/gateway/machines/${initial.machineId}/config`, {
        expectedRevision: 0,
        desired: w.desired,
        maxJobs: 2,
        enabled: true,
      });
      assert.equal(config.statusCode, 200, config.text);
      sync = await GatewaySync.open(owned.root, {
        machineId: initial.machineId,
        bootId,
        bootGeneration: generation,
        registry: w.registry,
        http,
        read: async (route) => machine.read(route),
        recipes: w.projections,
        archive: async (s) => w.sources.find((f) => f.source.name === s.name)!.stream(),
      });

      const unownedModelCommand = randomUUID();
      await db.begin(async (tx) => {
        const [cursor] =
          await tx`update gateway_command_cursor set value=value+1 where singleton returning value`;
        await tx`insert into gateway_commands(id,machine_id,type,payload,state,created_at,cursor) values(${unownedModelCommand},${initial.machineId},'sync_models','{}','queued',now(),${cursor.value})`;
      });
      await sync.reconcile();
      const [unowned] = await db`select state,result from gateway_commands where id=${unownedModelCommand}`;
      assert.equal(unowned.state, 'queued');
      assert.equal(unowned.result, null);
      const [applied] = await db`select * from gateway_applied where machine_id=${initial.machineId}`;
      assert.equal(Number(applied.revision), 1);
      const tickets = await ticketFixture(db),
        source = w.sources[1].source,
        projection = w.projections.find(
          (a) => a.runtime === 'codex' && a.sourceTreeSha256 === source.sourceTreeSha256,
        )!.expected,
        decisionId = randomUUID();
      const selection = {
        runtime: 'codex',
        sourceTreeSha256: source.sourceTreeSha256,
        projectionManifestSha256: projection.manifestSha256,
        projectionTreeSha256: projection.treeSha256,
        installReportId: String(applied.latest_report_id),
        configRevision: 1,
        decisionId,
      };
      await db`update projects set machine_id=${initial.machineId},checkout_path='/tmp/task5-private-fixture',binding_revision=2 where id=${tickets.project.id}`;
      await db`update tickets set status='ready',workflow_pin=${db.json(toDomainPin(source))} where id=${tickets.a.id}`;
      await db`insert into decisions(id,ticket_id,actor_kind,actor_id,kind,content,rationale,sources,scope) values(${decisionId},${tickets.a.id},'owner','owner','dispatch','Private DB authority','Private DB authority','[]',${db.json({ selection })})`;
      const created = await initial.owner.post('/v2/commands', {
        machineId: initial.machineId,
        ticketId: tickets.a.id,
        type: 'start',
        payload: { selection },
      });
      assert.equal(created.statusCode, 202, created.text);
      const command = created.json<any>();
      const permit = {
        commandId: command.id,
        ticketId: command.ticketId,
        machineId: initial.machineId,
        bindingRevision: 2,
        ticketRevision: 1,
        workflow: toDomainPin(source),
        checkedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 20000).toISOString(),
        telemetryId: randomUUID(),
        decisionId,
      };
      bridge = await TicketCommandBridge.open(owned.root, {
        machineId: initial.machineId,
        journal: w.journal,
        registry: w.registry,
        http,
        read: async (route) => machine.read(route),
        permit: async () => permit,
        command: ['/usr/bin/true'],
        recheckCapacity: async () => true,
      });
      drop = 'claim';
      await assert.rejects(bridge.handle(command), /LOST_REPLY/);
      const updated = await initial.owner.put(`/v2/gateway/machines/${initial.machineId}/config`, {
        expectedRevision: 1,
        desired: w.desired,
        maxJobs: 3,
        enabled: true,
      });
      assert.equal(updated.statusCode, 200, updated.text);
      await sync.reconcile();
      const [newApplied] =
        await db`select revision from gateway_applied where machine_id=${initial.machineId}`;
      assert.equal(Number(newApplied.revision), 2);
      const [stillUnowned] = await db`select state from gateway_commands where id=${unownedModelCommand}`;
      assert.equal(stillUnowned.state, 'queued');
      await bridge.handle(command);
      const durable = (await w.journal.processes())[0].authorization;
      assert(durable);
      const { attemptId: _attemptId, ...pair } = durable;
      const conflict = await initial.machine.post(`/v2/gateway/attempts/${durable.attemptId}/projection`, {
        ...pair,
        projectionTreeSha256: '0'.repeat(64),
      });
      assert.equal(conflict.statusCode, 409);

      await bridge.wait(command.id);
      const local = (await w.journal.processes())[0];
      const [attempt] = await db`select * from attempts where command_id=${command.id}`;
      assert.equal(await w.journal.observe(local), 'stopped');
      const stopped = await bridge.reportStopped(command.id);
      assert.equal(stopped.state, 'finalizing');
      const [guard] =
        await db`select active_attempt_id from execution_guards where ticket_id=${command.ticketId}`;
      assert.equal(guard.active_attempt_id, attempt.id);
      const replacement = await initial.machine.post(`/v2/machine/commands/${command.id}/claim`, {
        processInstanceId: randomUUID(),
        permit,
      });
      assert.equal(replacement.statusCode, 409);
      drop = 'result';
      const result = {
        fence: '1',
        processInstanceId: local.processInstanceId,
        outcome: 'retry' as const,
        evidenceIds: [],
        reason: null,
      };
      await assert.rejects(bridge.result(command.id, result), /LOST_REPLY/);
      assert.equal((await bridge.result(command.id, result)).state, 'finalizing');
      // Production verifier remains denied until a private DB-backed test authority is supplied.
      assert.equal((await w.registry.retained()).filter((r) => r.authority === 'process-journal').length, 1);
      await assert.rejects(bridge.retire(command.id), /FINALIZATION_MISMATCH/);
      assert.equal((await bridge.finalize(command.id)).state, 'finalizing');
      await assert.rejects(
        bridge.checkpoint(command.id, {
          fence: '2',
          processInstanceId: local.processInstanceId,
          sequence: '1',
          step: 'old',
          artifactIds: [],
          commit: null,
        }),
        /STALE_FENCE/,
      );
      await db`create table task5_final_receipts(attempt_id uuid primary key references attempts(id), command_id uuid not null, process_instance_id text not null, fence bigint not null, outcome text not null, receipt_id uuid not null)`;
      await db`insert into task5_final_receipts values(${attempt.id},${command.id},${local.processInstanceId},1,'retry',${randomUUID()})`;
      await server.close();
      const restarted = await buildApp({
        db,
        publicOrigin: 'http://localhost:5182',
        secureCookies: false,
        sessionEncryptionKey: initial.identity.key,
        now: () => new Date(),
        authorizeDispatch: authority.authorizeDispatch,
        gatewayProjectionPolicy: authority.projectionPolicy,
        verifyFinalResult: async (tx, input) => {
          const [receipt] =
            await tx`select r.* from task5_final_receipts r join attempts a on a.id=r.attempt_id where r.attempt_id=${input.attemptId} and r.command_id=a.command_id and r.process_instance_id=a.process_instance_id and r.fence=a.fence and r.outcome=${input.outcome}`;
          if (!receipt) throw new ApiError('FINAL_RESULT_PENDING', 409, 'Chưa có fixture receipt');
        },
      });
      const url = await restarted.listen({ host: '127.0.0.1', port: 0 });
      server = { close: () => restarted.close() };
      machine = machineTransport(url, initial.token);
      drop = 'finalize';
      await assert.rejects(bridge!.finalize(command.id), /LOST_REPLY/);
      assert.equal((await bridge!.finalize(command.id)).state, 'stopped');
      const receipt = await bridge!.retire(command.id);
      assert.equal(receipt.authority.attemptId, attempt.id);
      assert.equal((await w.registry.retained()).filter((r) => r.authority === 'process-journal').length, 0);
      assert.equal((await w.journal.processes()).length, 1);
      const [releasedGuard] =
        await db`select active_attempt_id from execution_guards where ticket_id=${command.ticketId}`;
      assert.equal(releasedGuard.active_attempt_id, null);
      const finalizeRequests = sent.filter((r) => r.phase === 'finalize');
      assert.equal(finalizeRequests.length, 3);
      assert.notEqual(finalizeRequests[0].idempotencyKey, finalizeRequests[1].idempotencyKey);
      assert.deepEqual(finalizeRequests[1], finalizeRequests[2]);
      assert.notEqual(
        finalizeRequests[0].idempotencyKey,
        sent.find((r) => r.phase === 'result').idempotencyKey,
      );
      const [events] =
        await db`select count(*)::int as count from events where type='attempt.finalized' and data->>'attemptId'=${String(attempt.id)}`;
      assert.equal(events.count, 1);
      const resultRequests = sent.filter((r) => r.phase === 'result');
      assert.deepEqual(resultRequests[0], resultRequests[1]);
    } finally {
      await bridge?.close();
      await sync?.close();
      await http.close();
      await server.close();
      await w.close();
      await owned.cleanup();
    }
  }));

for (const scenario of [
  'old-report',
  'disabled-runtime',
  'missing-decision',
  'mismatched-decision',
  'client-only-selection',
  'default-deny',
  'pause',
  'cancel',
  'fork-cancel',
] as const) {
  test(`execution bridge actual server selection and stop: ${scenario}`, () =>
    withDb(async (db) => {
      const owned = await bridgeRoot(),
        w = await workflowFixture(owned.root);
      const authority = await selectionAuthorityFixture(db);
      const server = await gatewayFixture(db, scenario === 'default-deny' ? {} : authority);
      const machine = machineTransport(server.url, server.token);
      let dropStopAck: string | null = null;
      const http = await HttpOperationJournal.open(owned.root, async (request) => {
        const response = await machine.write(request);
        if (
          dropStopAck &&
          request.route.includes(dropStopAck) &&
          request.phase === 'ticket-completed' &&
          response.status === 200
        ) {
          dropStopAck = null;
          throw new Error('LOST_STOP_ACK');
        }
        return response;
      });
      let bridge: TicketCommandBridge | undefined, sync: GatewaySync | undefined;
      let retainUnknown = false;
      try {
        const bootId = randomUUID();
        const boot = await server.machine.post('/v2/gateway/boots', { bootId, previousGeneration: '0' });
        assert.equal(boot.statusCode, 200);
        const config = await server.owner.put(`/v2/gateway/machines/${server.machineId}/config`, {
          expectedRevision: 0,
          desired: w.desired,
          maxJobs: 1,
          enabled: true,
        });
        assert.equal(config.statusCode, 200);
        sync = await GatewaySync.open(owned.root, {
          machineId: server.machineId,
          bootId,
          bootGeneration: boot.json<{ bootGeneration: string }>().bootGeneration,
          registry: w.registry,
          http,
          read: machine.read,
          recipes: w.projections,
          archive: async (s) => {
            const f = w.sources.find((f) => f.source.name === s.name);
            assert(f);
            return f.stream();
          },
        });
        await sync.reconcile();
        const [applied] =
          await db`select latest_report_id from gateway_applied where machine_id=${server.machineId}`;
        if (scenario === 'old-report') {
          const [prior] =
            await db`select report from gateway_install_reports where id=${String(applied.latest_report_id)}`;
          const newer = await server.machine.post('/v2/gateway/install-reports', {
            ...(prior.report as object),
            reportId: randomUUID(),
          });
          assert.equal(newer.statusCode, 200);
        }
        const tickets = await ticketFixture(db),
          source = w.sources[1].source;
        const projection = w.projections.find(
          (a) => a.runtime === 'codex' && a.sourceTreeSha256 === source.sourceTreeSha256,
        );
        assert(projection);
        const decisionId = randomUUID();
        const selection = {
          runtime: 'codex',
          sourceTreeSha256: source.sourceTreeSha256,
          projectionManifestSha256: projection.expected.manifestSha256,
          projectionTreeSha256: projection.expected.treeSha256,
          installReportId: String(applied.latest_report_id),
          configRevision: 1,
          decisionId,
        };
        await db`update projects set machine_id=${server.machineId},checkout_path='/tmp/task5-private-fixture',binding_revision=2 where id=${tickets.project.id}`;
        await db`update tickets set status='ready',workflow_pin=${db.json(toDomainPin(source))} where id=${tickets.a.id}`;
        if (scenario !== 'missing-decision')
          await db`insert into decisions(id,ticket_id,actor_kind,actor_id,kind,content,rationale,sources,scope) values(${decisionId},${tickets.a.id},'owner','owner','dispatch','Private fixture','Private fixture','[]',${db.json({ selection: scenario === 'mismatched-decision' ? { ...selection, installReportId: randomUUID() } : selection })})`;
        const response = await server.owner.post('/v2/commands', {
          machineId: server.machineId,
          ticketId: tickets.a.id,
          type: 'start',
          payload: scenario === 'client-only-selection' ? {} : { selection },
        });
        assert.equal(response.statusCode, 202, response.text);
        const command = response.json<import('../src/commands/contracts.ts').Command>();
        const permit = {
          commandId: command.id,
          ticketId: command.ticketId,
          machineId: server.machineId,
          bindingRevision: 2,
          ticketRevision: 1,
          workflow: toDomainPin(source),
          checkedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 20000).toISOString(),
          telemetryId: randomUUID(),
          decisionId,
        };
        if (scenario === 'disabled-runtime') {
          const desired = structuredClone(
            w.desired,
          ) as import('../src/commands/contracts.ts').GatewayConfig['desired'];
          desired.superpowers.projections.codex = null;
          const update = await server.owner.put(`/v2/gateway/machines/${server.machineId}/config`, {
            expectedRevision: 1,
            desired,
            maxJobs: 1,
            enabled: true,
          });
          assert.equal(update.statusCode, 200);
        }
        const stopping = ['pause', 'cancel', 'fork-cancel'].includes(scenario);
        const marker = join(owned.root, 'escaped-pid');
        const runtime =
          scenario === 'fork-cancel'
            ? [
                process.execPath,
                '-e',
                `const child=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},700)'],{detached:true,stdio:'ignore'});child.unref();require('node:fs').writeFileSync(${JSON.stringify(marker)},String(child.pid));setTimeout(()=>{},10000)`,
              ]
            : stopping
              ? ['/bin/sleep', '10']
              : ['/usr/bin/true'];
        bridge = await TicketCommandBridge.open(owned.root, {
          machineId: server.machineId,
          journal: w.journal,
          registry: w.registry,
          http,
          read: machine.read,
          permit: async () => permit,
          command: runtime,
          recheckCapacity: async () => true,
        });
        if (stopping) {
          await bridge.handle(command);
          const local = (await w.journal.processes())[0];
          assert(local);
          if (scenario === 'fork-cancel') {
            for (let n = 0; n < 100; n++) {
              try {
                await readFile(marker);
                break;
              } catch {
                await delay(10);
              }
            }
            const pid = Number(await readFile(marker, 'utf8'));
            const identity = await w.journal.identity.probe(pid);
            assert(identity);
            console.log('Task5 owned escaped child', JSON.stringify(identity));
          } else await delay(100);
          const requested = await server.owner.post('/v2/commands', {
            machineId: server.machineId,
            ticketId: command.ticketId,
            type: scenario === 'pause' ? 'pause' : 'cancel',
            payload: { reason: 'Test owned stop', decisionId },
          });
          assert.equal(requested.statusCode, 202, requested.text);
          const stop = requested.json<import('../src/commands/contracts.ts').Command>();
          await assert.rejects(
            bridge.handle({ ...stop, type: stop.type === 'pause' ? 'cancel' : 'pause' }),
            /COMMAND_CHANGED/,
          );
          assert.equal(await w.journal.observe(local), 'running');
          retainUnknown = true;
          if (scenario === 'fork-cancel') {
            await assert.rejects(bridge.handle(stop), /EXACT_EXIT_PROOF_REQUIRED/);
            assert.equal(await w.journal.observe(local), 'unknown');
            const [guard] =
              await db`select active_attempt_id from execution_guards where ticket_id=${command.ticketId}`;
            assert(guard.active_attempt_id);
            assert.equal(
              (await w.registry.retained()).filter((r) => r.authority === 'process-journal').length,
              1,
            );
            const ack = (await machine.read(`/v2/machine/commands/${stop.id}`)) as { state: string };
            assert.notEqual(ack.state, 'completed');
            await delay(800);
          } else {
            dropStopAck = stop.id;
            await assert.rejects(bridge.handle(stop), /LOST_STOP_ACK/);
            await bridge.handle(stop);
            assert.equal(await w.journal.observe(local), 'stopped');
            retainUnknown = false;
            const [attempt] =
              await db`select state,finalized_at from attempts where command_id=${command.id}`;
            assert.equal(attempt.state, 'stopped');
            assert(attempt.finalized_at);
            await bridge.retire(command.id);
            assert.equal(
              (await w.registry.retained()).filter((r) => r.authority === 'process-journal').length,
              0,
            );
          }
          return;
        }
        await assert.rejects(
          bridge.handle(
            scenario === 'client-only-selection' ? { ...command, payload: { selection } } : command,
          ),
          /SELECTION_MISMATCH|PROJECTION_UNAVAILABLE|COMMAND_CHANGED|DISPATCH_NOT_CONFIGURED/,
        );
        const [attempts] =
          await db`select count(*)::int as count from attempts where command_id=${command.id}`;
        assert.equal(attempts.count, 0);
        for (const record of await w.journal.processes()) assert.equal(record.authorization, null);
      } finally {
        await bridge?.close();
        await sync?.close();
        await http.close();
        await server.close();
        await w.close();
        if (retainUnknown) {
          const st = await lstat(owned.root);
          console.log(
            'Task5 retained UNKNOWN root',
            JSON.stringify({
              root: owned.root,
              device: String(st.dev),
              inode: String(st.ino),
              uid: st.uid,
              stage: scenario,
            }),
          );
        } else await owned.cleanup();
      }
    }));
}
