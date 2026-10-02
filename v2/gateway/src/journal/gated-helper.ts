import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite, hash, readRecord } from './atomic-records.ts';
import { ProcessIdentity } from './native.ts';
import { type LaunchRecord, makeStartIdentity, type ReadyRecord } from './process-journal.ts';

let identity: ProcessIdentity | null = null;
let ready: ReadyRecord | null = null;
let record: LaunchRecord | null = null;
let root = '';
let command: string[] | null = null;
let released = false;
let releaseRequested = false;
let initializing = false;
let gateClosed = false;
process.on('disconnect', async () => {
  gateClosed = true;
  if (!released) {
    try {
      if (record && ready)
        await atomicWrite(join(root, 'proofs', `${hash(record.launchId)}-tree.json`), {
          ...ready,
          treeEmpty: true,
          forkObserved: false,
          exitCode: 0,
          gateClosed: true,
        });
    } finally {
      process.exit(0);
    }
  }
});
process.on(
  'message',
  async (message: {
    type: string;
    root: string;
    record: LaunchRecord;
    command: string[] | null;
    launchId?: string;
  }) => {
    try {
      if (message.type === 'INIT' && !initializing) {
        initializing = true;
        root = message.root;
        record = message.record;
        command = message.command;
        let source = fileURLToPath(new URL('./native-identity.c', import.meta.url));
        try {
          await access(source);
        } catch {
          source = fileURLToPath(new URL('../../../src/journal/native-identity.c', import.meta.url));
        }
        identity = await ProcessIdentity.open(root, source);
        const p = await identity.probe(process.pid);
        if (!p || p.uid !== process.getuid?.() || p.processGroupId !== process.pid)
          throw new Error('IDENTITY_UNKNOWN');
        ready = {
          formatVersion: 1,
          launchId: record.launchId,
          processInstanceId: record.processInstanceId,
          pid: process.pid,
          startIdentity: makeStartIdentity(record.launchId, p),
          processGroupId: p.processGroupId,
          uid: p.uid,
        };
        await atomicWrite(join(root, 'proofs', `${hash(record.launchId)}-ready.json`), ready);
        if (!process.connected || gateClosed) process.exit(0);
        process.send?.({ type: 'READY' });
        return;
      }
      if (
        message.type === 'RELEASE' &&
        !released &&
        !releaseRequested &&
        record &&
        message.launchId === record.launchId &&
        command
      ) {
        releaseRequested = true;
        const stored = await readRecord<LaunchRecord>(join(root, `${hash(record.commandId)}.json`));
        if (!stored || stored.launchId !== record.launchId || !stored.authorization)
          throw new Error('NO_AUTHORIZATION');
        if (!identity || !ready) throw new Error('NO_READY');
        if (gateClosed || !process.connected) throw new Error('GATE_CLOSED');
        const releasedRecord = record;
        const releasedReady = ready;
        released = true;
        const child = await identity.supervise(command);
        let output = '';
        child.stdout?.on('data', (chunk) => {
          output += chunk;
          if (output.length > 4096) child.stdout?.destroy();
        });
        child.once('error', () => process.exit(1));
        child.once('close', async (code) => {
          try {
            if (code !== 0) throw new Error('TREE_UNKNOWN');
            const proof = JSON.parse(output);
            if (typeof proof.treeEmpty !== 'boolean' || typeof proof.forkObserved !== 'boolean')
              throw new Error('TREE_UNKNOWN');
            await atomicWrite(join(root, 'proofs', `${hash(releasedRecord.launchId)}-tree.json`), {
              ...releasedReady,
              formatVersion: 1,
              treeEmpty: proof.treeEmpty,
              forkObserved: proof.forkObserved,
              exitCode: proof.exitCode,
            });
            process.exit(proof.exitCode);
          } catch {
            process.exit(1);
          }
        });
      }
    } catch {
      process.exit(1);
    }
  },
);
