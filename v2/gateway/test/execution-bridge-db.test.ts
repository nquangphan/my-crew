import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../../server/src/app.ts';
import { ApiError } from '../../server/src/platform/errors.ts';
import { databaseFixture } from '../../server/test/support/db.ts';
import { gatewayFixture, heartbeat, selectionAuthorityFixture } from '../../server/test/support/gateway.ts';
import { ticketFixture } from '../../server/test/support/tickets.ts';
import { toDomainPin } from '../src/commands/contracts.ts';
import { machineTransport } from '../src/commands/http-client.ts';
import { TicketCommandBridge } from '../src/execution/ticket-command-bridge.ts';
import { HttpOperationJournal } from '../src/journal/http-operations.ts';
import { GatewayConnection } from '../src/sync/connection.ts';
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
      const stoppedConnection = await GatewayConnection.open(owned.root, http, bridge);
      try {
        await stoppedConnection.boot(bootId, '0');
        assert.equal((await stoppedConnection.advanceBoot(randomUUID())).bootGeneration, '2');
      } finally {
        await stoppedConnection.close();
      }

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
      // Without retirement the scoped 404 remains a local failure, but independent B still progresses.
      await db`update projects set binding_revision=3 where id=${tickets.project.id}`;
      const { createCommand } = await import('../../server/src/execution/commands.ts');
      const independent = await db.begin(async (tx) =>
        createCommand(
          tx,
          { machineId: initial.machineId, ticketId: tickets.b.id, type: 'reconcile', payload: {} },
          { kind: 'owner', id: 'owner' },
        ),
      );
      await assert.rejects(bridge.reconnect(), /NOT_FOUND/);
      assert.equal(
        ((await machine.read(`/v2/machine/commands/${independent.id}`)) as { state: string }).state,
        'completed',
      );
      assert.equal(await w.journal.pinRetirement(local), null);
      assert.equal((await w.registry.retained()).filter((r) => r.authority === 'process-journal').length, 1);
      await db`update projects set binding_revision=2 where id=${tickets.project.id}`;
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
      // Immutable retired history remains local after the actual scoped API stops exposing it.
      await db`update projects set checkout_path='/tmp/task5-rebound',binding_revision=3 where id=${tickets.project.id}`;
      await assert.rejects(machine.read(`/v2/machine/commands/${command.id}`), /NOT_FOUND/);
      const control = await db.begin(async (tx) =>
        createCommand(
          tx,
          { machineId: initial.machineId, ticketId: tickets.b.id, type: 'reconcile', payload: {} },
          { kind: 'owner', id: 'owner' },
        ),
      );
      await bridge.close();
      bridge = await TicketCommandBridge.open(owned.root, {
        machineId: initial.machineId,
        journal: w.journal,
        registry: w.registry,
        http,
        read: async (route) => machine.read(route),
      });
      await bridge.reconnect();
      assert.equal(
        ((await machine.read(`/v2/machine/commands/${control.id}`)) as { state: string }).state,
        'completed',
      );
      assert.deepEqual(await w.journal.pinRetirement(local), receipt);
      let connection = await GatewayConnection.open(owned.root, http, bridge);
      try {
        assert.equal((await connection.boot()).bootGeneration, '2');
        const nextBoot = randomUUID();
        drop = 'boot';
        await assert.rejects(connection.advanceBoot(nextBoot), /LOST_REPLY/);
        await connection.close();
        connection = await GatewayConnection.open(owned.root, http, bridge);
        assert.deepEqual(await connection.boot(), { bootId: nextBoot, bootGeneration: '3' });
        await connection.heartbeat(heartbeat(nextBoot, '3', '999'));
        const [present] =
          await db`select sequence,boot_id from gateway_heartbeats where machine_id=${initial.machineId}`;
        assert.equal(String(present.sequence), '1');
        assert.equal(present.boot_id, nextBoot);
        await assert.rejects(connection.advanceBoot(bootId), /BOOT_RETIRED/);
        assert.equal(
          ((await http.replay(`boot:${bootId}`)).body as { bootGeneration: string }).bootGeneration,
          '1',
        );
      } finally {
        await connection.close();
      }
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
          if (scenario === 'pause') {
            const connection = await GatewayConnection.open(owned.root, http, bridge);
            try {
              await connection.boot(bootId, '0');
              assert.equal((await connection.advanceBoot(randomUUID())).bootGeneration, '2');
            } finally {
              await connection.close();
            }
          }
          const blockedId = randomUUID();
          if (scenario !== 'fork-cancel') {
            await db`insert into commands(id,machine_id,ticket_id,binding_revision,type,payload,state) values(${blockedId},${server.machineId},${tickets.b.id},2,'start','{}','queued')`;
            // Reconciliation of a durable owned uncertain launch precedes the denied new dispatch.
            await db`update attempts set state='uncertain' where command_id=${command.id}`;
          }
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
            const connection = await GatewayConnection.open(owned.root, http, bridge);
            try {
              await connection.boot(bootId, '0');
              const nextBoot = randomUUID();
              assert.equal((await connection.advanceBoot(nextBoot)).bootGeneration, '2');
              await connection.heartbeat(heartbeat(nextBoot, '2', '99'));
              const [stillHeld] =
                await db`select active_attempt_id from execution_guards where ticket_id=${command.ticketId}`;
              assert.equal(stillHeld.active_attempt_id, guard.active_attempt_id);
              assert.equal(await w.journal.pinRetirement(local), null);
              assert.equal(
                (await w.registry.retained()).filter((r) => r.authority === 'process-journal').length,
                1,
              );
              const replacement = await server.machine.post(`/v2/machine/commands/${command.id}/claim`, {
                processInstanceId: randomUUID(),
                permit,
              });
              assert.equal(replacement.statusCode, 409);
            } finally {
              await connection.close();
            }
            await delay(800);
          } else {
            dropStopAck = stop.id;
            await assert.rejects(bridge.reconnect(), /LOST_STOP_ACK/);
            await assert.rejects(bridge.reconnect(), /SELECTION_MISMATCH/);
            assert.equal(
              ((await machine.read(`/v2/machine/commands/${stop.id}`)) as { state: string }).state,
              'completed',
            );
            const [blocked] = await db`select state from commands where id=${blockedId}`;
            assert.equal(blocked.state, 'queued');
            assert.equal((await w.journal.processes()).length, 1);
            const stopReceipt = await w.journal.pinRetirement(local);
            assert(stopReceipt);
            assert.equal(stopReceipt.stop.groupEmpty, true);
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

test('actual prefix8 desired read barrier cannot supersede a newly committed workflow command', () =>
  withDb(async (db) => {
    const owned = await bridgeRoot(),
      w = await workflowFixture(owned.root),
      authority = await selectionAuthorityFixture(db),
      server = await gatewayFixture(db, authority);
    const machine = machineTransport(server.url, server.token);
    const http = await HttpOperationJournal.open(owned.root, machine.write);
    let sync: GatewaySync | undefined;
    try {
      const bootId = randomUUID();
      const boot = await server.machine.post('/v2/gateway/boots', { bootId, previousGeneration: '0' });
      assert.equal(boot.statusCode, 200);
      const update = async (expectedRevision: number) => {
        const response = await server.owner.put(`/v2/gateway/machines/${server.machineId}/config`, {
          expectedRevision,
          desired: w.desired,
          maxJobs: expectedRevision + 2,
          enabled: true,
        });
        assert.equal(response.statusCode, 200, response.text);
      };
      await update(0);
      let barrier = true;
      const options = {
        machineId: server.machineId,
        bootId,
        bootGeneration: boot.json<{ bootGeneration: string }>().bootGeneration,
        registry: w.registry,
        http,
        recipes: w.projections,
        archive: async (source: import('../src/host/status.ts').SourcePin) =>
          w.sources.find((item) => item.source.name === source.name)!.stream(),
        read: async (route: string) => {
          const result = await machine.read(route);
          if (route === '/v2/gateway/config' && barrier) {
            barrier = false;
            await update(1);
          }
          return result;
        },
      };
      sync = await GatewaySync.open(owned.root, options);
      await sync.reconcile();
      const [newer] =
        await db`select id,state from gateway_commands where machine_id=${server.machineId} and payload->>'configRevision'='2'`;
      assert.notEqual(newer.state, 'completed');
      await sync.close();
      sync = await GatewaySync.open(owned.root, options);
      await sync.reconcile();
      await sync.reconcile();
      const [complete] = await db`select state,result from gateway_commands where id=${newer.id}`;
      assert.equal(complete.state, 'completed');
      assert.deepEqual(complete.result, { ok: true });
      const [reports] =
        await db`select count(*)::int as count from gateway_install_reports where machine_id=${server.machineId} and config_revision=2`;
      assert.equal(reports.count, 1);
    } finally {
      await sync?.close();
      await http.close();
      await server.close();
      await w.close();
      await owned.cleanup();
    }
  }));

test('actual prefix8 503 after committed boot heartbeat ACK and report recovers same server receipts across reopen', () =>
  withDb(async (db) => {
    const owned = await bridgeRoot(),
      w = await workflowFixture(owned.root),
      authority = await selectionAuthorityFixture(db),
      server = await gatewayFixture(db, authority);
    const machine = machineTransport(server.url, server.token),
      failed = new Set<string>();
    const sent: import('../src/journal/http-operations.ts').HttpRequest[] = [];
    let now = 0;
    const http = await HttpOperationJournal.open(
      owned.root,
      async (request) => {
        sent.push(request);
        const response = await machine.write(request);
        assert.equal(response.status, 200, JSON.stringify(response));
        if (!failed.has(request.phase)) {
          failed.add(request.phase);
          return { status: 503, body: { error: { code: 'UPSTREAM_LOST_AFTER_COMMIT' } } };
        }
        return response;
      },
      { now: () => now },
    );
    let connection = await GatewayConnection.open(owned.root, http),
      sync: GatewaySync | undefined;
    try {
      const bootId = randomUUID();
      await assert.rejects(connection.boot(bootId), /UPSTREAM_LOST/);
      await connection.close();
      connection = await GatewayConnection.open(owned.root, http);
      now += 10000;
      assert.equal((await connection.boot()).bootGeneration, '1');
      await assert.rejects(connection.heartbeat(heartbeat(bootId, '1', '1')), /UPSTREAM_LOST/);
      await connection.close();
      connection = await GatewayConnection.open(owned.root, http);
      now += 10000;
      await connection.heartbeat({ ignored: 'pending original body' });
      const config = await server.owner.put(`/v2/gateway/machines/${server.machineId}/config`, {
        expectedRevision: 0,
        desired: w.desired,
        maxJobs: 1,
        enabled: true,
      });
      assert.equal(config.statusCode, 200, config.text);
      const options = {
        machineId: server.machineId,
        bootId,
        bootGeneration: '1',
        registry: w.registry,
        http,
        read: machine.read,
        recipes: w.projections,
        archive: async (source: import('../src/host/status.ts').SourcePin) =>
          w.sources.find((item) => item.source.name === source.name)!.stream(),
      };
      sync = await GatewaySync.open(owned.root, options);
      for (let i = 0; i < 3; i++) {
        await assert.rejects(sync.reconcile(), /UPSTREAM_LOST/);
        await sync.close();
        sync = await GatewaySync.open(owned.root, options);
        now += 10000;
      }
      await sync.reconcile();
      await sync.reconcile();
      for (const phase of ['boot', 'heartbeat', 'gateway-received', 'install-report', 'gateway-completed']) {
        const attempts = sent.filter((request) => request.phase === phase);
        assert.equal(attempts.length, 2, phase);
        assert.deepEqual(attempts[0], attempts[1]);
        assert.equal((await http.replay(attempts[0].operationId)).status, 503);
      }
      const [reports] =
        await db`select count(*)::int as count from gateway_install_reports where machine_id=${server.machineId}`;
      assert.equal(reports.count, 1);
      const [present] =
        await db`select sequence from gateway_heartbeats where machine_id=${server.machineId}`;
      assert.equal(String(present.sequence), '1');
    } finally {
      await sync?.close();
      await connection.close();
      await http.close();
      await server.close();
      await w.close();
      await owned.cleanup();
    }
  }));

for (const failure of ['server-cas', 'orphan-admission'] as const)
  test(`actual prefix8 controlled boot rejects ${failure} and preserves history`, () =>
    withDb(async (db) => {
      const owned = await bridgeRoot(),
        w = await workflowFixture(owned.root),
        server = await gatewayFixture(db);
      const machine = machineTransport(server.url, server.token),
        http = await HttpOperationJournal.open(owned.root, machine.write);
      const bridge = await TicketCommandBridge.open(owned.root, {
        machineId: server.machineId,
        journal: w.journal,
        registry: w.registry,
        http,
        read: machine.read,
      });
      const connection = await GatewayConnection.open(owned.root, http, bridge);
      let retained = false;
      try {
        const first = await connection.boot(randomUUID());
        if (failure === 'server-cas') {
          const rival = await server.machine.post('/v2/gateway/boots', {
            bootId: randomUUID(),
            previousGeneration: '1',
          });
          assert.equal(rival.statusCode, 200);
          await assert.rejects(connection.advanceBoot(randomUUID()), /BOOT_GENERATION_CONFLICT/);
          await assert.rejects(connection.heartbeat(heartbeat(first.bootId, '1', '1')), /BOOT_REQUIRED/);
        } else {
          await w.install();
          const store = Reflect.get(
            w.journal,
            'store',
          ) as import('../src/journal/atomic-records.ts').AtomicRecords;
          const original = store.put.bind(store);
          store.put = async (key, value) => {
            if ((value as { launchId?: string }).launchId) throw new Error('ADMISSION_COMMIT_CRASH');
            return original(key, value);
          };
          try {
            await assert.rejects(
              w.journal.reserve({
                commandId: randomUUID(),
                ticketId: randomUUID(),
                processInstanceId: randomUUID(),
                source: w.sources[0].source,
                projection: w.projections[0].expected,
              }),
              /ADMISSION_COMMIT_CRASH/,
            );
          } finally {
            store.put = original;
          }
          retained = true;
          assert.equal((await w.journal.pendingPinAdmissions()).length, 1);
          await assert.rejects(connection.advanceBoot(randomUUID()), /BOOT_RECONCILIATION_CHANGED/);
          assert.equal((await connection.boot()).bootGeneration, '1');
          assert.equal((await w.journal.pendingPinAdmissions()).length, 1);
        }
      } finally {
        await connection.close();
        await bridge.close();
        await http.close();
        await server.close();
        await w.close();
        if (retained) {
          const st = await lstat(owned.root);
          console.log(
            'Task5 retained UNKNOWN root',
            JSON.stringify({
              root: owned.root,
              device: String(st.dev),
              inode: String(st.ino),
              uid: st.uid,
              stage: failure,
            }),
          );
        } else await owned.cleanup();
      }
    }));

test('actual prefix8 pending old-boot report resolves old key then resamples under controlled new boot', () =>
  withDb(async (db) => {
    const owned = await bridgeRoot(),
      w = await workflowFixture(owned.root),
      authority = await selectionAuthorityFixture(db),
      server = await gatewayFixture(db, authority);
    const machine = machineTransport(server.url, server.token);
    let drop = true;
    const sent: import('../src/journal/http-operations.ts').HttpRequest[] = [];
    const http = await HttpOperationJournal.open(owned.root, async (request) => {
      sent.push(request);
      if (request.phase === 'install-report' && drop) {
        drop = false;
        throw new Error('REPORT_LOST_BEFORE_SEND');
      }
      return machine.write(request);
    });
    const bridge = await TicketCommandBridge.open(owned.root, {
      machineId: server.machineId,
      journal: w.journal,
      registry: w.registry,
      http,
      read: machine.read,
    });
    const connection = await GatewayConnection.open(owned.root, http, bridge);
    let sync: GatewaySync | undefined;
    try {
      const initial = await connection.boot(randomUUID());
      const config = await server.owner.put(`/v2/gateway/machines/${server.machineId}/config`, {
        expectedRevision: 0,
        desired: w.desired,
        maxJobs: 1,
        enabled: true,
      });
      assert.equal(config.statusCode, 200);
      const options = {
        machineId: server.machineId,
        ...initial,
        registry: w.registry,
        http,
        read: machine.read,
        recipes: w.projections,
        archive: async (source: import('../src/host/status.ts').SourcePin) =>
          w.sources.find((item) => item.source.name === source.name)!.stream(),
      };
      sync = await GatewaySync.open(owned.root, options);
      await assert.rejects(sync.reconcile(), /REPORT_LOST_BEFORE_SEND/);
      await sync.close();
      const next = await connection.advanceBoot(randomUUID());
      sync = await GatewaySync.open(owned.root, { ...options, ...next });
      await sync.reconcile();
      await sync.reconcile();
      const reports = sent.filter((request) => request.phase === 'install-report');
      assert.equal(reports.length, 3);
      assert.deepEqual(reports[0], reports[1]);
      assert.notEqual(reports[1].idempotencyKey, reports[2].idempotencyKey);
      assert.equal((await http.replay(reports[0].operationId)).status, 409);
      const [stored] =
        await db`select report from gateway_install_reports where machine_id=${server.machineId}`;
      assert.equal(stored.report.bootId, next.bootId);
      const [command] =
        await db`select state,result from gateway_commands where machine_id=${server.machineId}`;
      assert.equal(command.state, 'completed');
      assert.deepEqual(command.result, { ok: true });
    } finally {
      await sync?.close();
      await connection.close();
      await bridge.close();
      await http.close();
      await server.close();
      await w.close();
      await owned.cleanup();
    }
  }));
