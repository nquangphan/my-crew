import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Attempt, Command, Permit } from '../src/commands/contracts.ts';
import { TicketCommandBridge } from '../src/execution/ticket-command-bridge.ts';
import { HttpOperationJournal } from '../src/journal/http-operations.ts';
import { RuntimeLaunch } from '../src/runtime/launch.ts';
import { workflowFixture } from './support/bridge-fixture.ts';
import { runtimeRoot } from './support/runtime-fixture.ts';

for (const stage of ['ready', 'claim', 'companion', 'runtime-pin', 'authorized', 'released'])
  test(`runtime boundary SIGKILL at ${stage} keeps exact launch and retains unproven pins`, async () => {
    const owned = await runtimeRoot();
    const child = fork(new URL('./support/runtime-crash-worker.ts', import.meta.url), [owned.root, stage], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`STAGE_TIMEOUT ${stage} ${stderr}`)), 15000);
        child.once('message', (message: unknown) => {
          const data = message as { identity: { pid: number; birth: string; uid: number }; argv: string[] };
          assert.equal(data.identity.pid, child.pid);
          assert.equal(data.identity.uid, process.getuid?.());
          assert(data.identity.birth);
          console.log(JSON.stringify({ action: 'owned-crash-child', root: owned.root, ...data }));
          clearTimeout(timer);
          resolve();
        });
        child.once('exit', () => {
          clearTimeout(timer);
          reject(new Error(`EARLY_EXIT ${stderr}`));
        });
      });
      const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGKILL');
      await ended;
      await delay(800);
      const state = JSON.parse(await readFile(join(owned.root, 'fixture-server.json'), 'utf8')) as {
        command: Command;
        permit: Permit;
        attempt: Attempt | null;
      };
      const w = await workflowFixture(owned.root);
      const http = await HttpOperationJournal.open(owned.root, async (req) => {
        if (req.phase === 'claim' && state.attempt) return { status: 200, body: state.attempt };
        return { status: 200, body: state.command };
      });
      const bridge = await TicketCommandBridge.open(owned.root, {
        machineId: state.command.machineId,
        journal: w.journal,
        registry: w.registry,
        http,
        read: async (route) =>
          route === '/v2/gateway/config'
            ? { desired: w.desired }
            : route.includes('/commands/')
              ? state.command
              : state.attempt,
        permit: async () => state.permit,
      });
      try {
        const old = (await w.journal.processes())[0];
        assert(old);
        const replay = await bridge.reserve(state.command);
        assert.equal(replay.processInstanceId, old.processInstanceId);
        assert.equal((await w.journal.processes()).length, 1);
        const runtime = await RuntimeLaunch.open(owned.root, { journal: w.journal, registry: w.registry });
        try {
          assert.equal(
            !!(await runtime.read(old.launchId)),
            ['runtime-pin', 'authorized', 'released'].includes(stage),
          );
        } finally {
          await runtime.close();
        }
        if (stage !== 'released')
          await assert.rejects(readFile(join(owned.root, 'side-effect')), { code: 'ENOENT' });
        await assert.rejects(bridge.handle(state.command), /PROCESS_UNKNOWN|RECONCILE_REQUIRED/);
        assert.equal(
          (await w.registry.retained()).filter((r) => r.authority === 'process-journal').length,
          1,
        );
        await assert.rejects(bridge.retire(state.command.id), /EXACT_EXIT_PROOF_REQUIRED|CLAIM_UNCONFIRMED/);
        const ready = await w.journal.ready(old);
        if (ready) assert.equal(await w.journal.identity.groupEmpty(ready.processGroupId), true);
      } finally {
        await bridge.close();
        await http.close();
        await w.close();
      }
      {
        const identity = await lstat(owned.root);
        console.log(
          'Task3 retained UNKNOWN root',
          JSON.stringify({
            root: owned.root,
            device: String(identity.dev),
            inode: String(identity.ino),
            uid: identity.uid,
            stage,
          }),
        );
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        child.kill('SIGKILL');
        await ended;
      }
    }
  });
