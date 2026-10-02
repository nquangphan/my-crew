import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Launcher } from '../src/journal/process-journal.ts';
import { bridgeRoot, workflowFixture } from './support/bridge-fixture.ts';

test('native stop control preserves gated proof, pending startup, repeated TERM and completed observer', async () => {
  const owned = await bridgeRoot(),
    w = await workflowFixture(owned.root);
  await w.install();
  let unknown = false;
  try {
    for (const boundary of ['gated', 'release-race', 'running', 'completed'] as const) {
      const source = w.sources[1].source,
        projection = w.projections[3].expected;
      const record = await w.journal.reserve({
        commandId: randomUUID(),
        ticketId: randomUUID(),
        processInstanceId: randomUUID(),
        source,
        projection,
      });
      const marker = join(owned.root, `${boundary}-ran`);
      const pin = {
        attemptId: randomUUID(),
        fence: '1',
        processInstanceId: record.processInstanceId,
        sourceTreeSha256: source.sourceTreeSha256,
        runtime: projection.runtime,
        projectionManifestSha256: projection.manifestSha256,
        projectionTreeSha256: projection.treeSha256,
        installReportId: randomUUID(),
      };
      const launcher = new Launcher(w.journal, {
        command: [
          process.execPath,
          '-e',
          `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran');setTimeout(()=>{},200)`,
        ],
        verifyProjection: async () => pin,
        recheckCapacity: async () => true,
      });
      try {
        const ready = await launcher.spawnGated(record);
        if (boundary !== 'gated') await launcher.release(record, pin.fence, pin.attemptId);
        if (boundary === 'running') {
          for (let n = 0; n < 100; n++) {
            try {
              await readFile(marker);
              break;
            } catch {
              await delay(5);
            }
          }
          assert.equal(await readFile(marker, 'utf8'), 'ran');
        }
        if (boundary !== 'completed') {
          process.kill(-ready.processGroupId, 'SIGTERM');
          if (boundary === 'running') {
            const probe = await w.journal.identity.probe(ready.pid);
            if (
              probe &&
              `${record.launchId}:${probe.pid}:${probe.birth}:${probe.processGroupId}:${probe.uid}` ===
                ready.startIdentity
            )
              process.kill(-ready.processGroupId, 'SIGTERM');
          }
        }
        await launcher.wait(record);
        const observation = await w.journal.observe(record);
        assert.equal(await w.journal.identity.groupEmpty(ready.processGroupId), true);
        if (boundary === 'release-race' && observation === 'unknown') unknown = true;
        else assert.equal(observation, 'stopped');
        if (boundary === 'gated') await assert.rejects(readFile(marker), { code: 'ENOENT' });
        // A finished helper/supervisor is never reused as a live signal destination.
        assert.equal(await w.journal.identity.probe(ready.pid), null);
        await assert.rejects(
          launcher.release(record, pin.fence, pin.attemptId),
          /RECONCILE_REQUIRED|PROCESS_UNKNOWN/,
        );
        assert.equal(
          (await w.registry.retained()).some(
            (ref) => ref.source.sourceTreeSha256 === source.sourceTreeSha256,
          ),
          true,
        );
      } finally {
        await launcher.close();
      }
    }
  } finally {
    await w.close();
    if (unknown) {
      const st = await lstat(owned.root);
      console.log(
        'Task5 retained UNKNOWN root',
        JSON.stringify({
          root: owned.root,
          device: String(st.dev),
          inode: String(st.ino),
          uid: st.uid,
          stage: 'release-race',
        }),
      );
    } else await owned.cleanup();
  }
});
