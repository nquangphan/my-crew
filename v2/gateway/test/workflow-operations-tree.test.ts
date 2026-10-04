import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { lstat, mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { AtomicRecords, readRecord } from '../src/journal/atomic-records.ts';
import { type ExecutionReceipt, type OwnedIdentity, OwnedOperations } from '../src/workflows/operations.ts';

let root: string;
let path: string;
let store: AtomicRecords;
let ops: OwnedOperations;
// Every process these tests start carries a distinctive argv so cleanup never signals a reused pid.
const started: { pid: number; command: string }[] = [];

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
function commandOf(pid: number): string {
  try {
    return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}
async function stage(id: string): Promise<{ identity: OwnedIdentity; location: string }> {
  return { identity: await ops.create(id), location: join(path, 'stages', id) };
}
async function logLines(location: string): Promise<string[]> {
  return (await readFile(join(location, 'execution.log'), 'utf8')).trim().split('\n');
}
function remember(pid: number, command: string): number {
  assert(Number.isInteger(pid) && pid > 1, `pid ${pid}`);
  started.push({ pid, command });
  return pid;
}
async function receiptOf(id: string): Promise<ExecutionReceipt | null> {
  return readRecord<ExecutionReceipt>(join(path, 'receipts', `${id}.json`));
}

before(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'crew-s6b-tree-')));
  path = join(root, 'workflows');
  store = await AtomicRecords.open(path);
  ops = await OwnedOperations.open(path, store);
});
after(async () => {
  for (const { pid, command } of started)
    if (alive(pid) && commandOf(pid).includes(command)) process.kill(pid, 'SIGKILL');
  await store.close();
  await rm(root, { recursive: true, force: true });
});

test('execute-tree proves a forked child that exits before the leader and records the leader', async () => {
  const startedMs = Date.now();
  const { identity, location } = await stage('tree-pass');
  const receipt = await ops.executeTree(
    'tree-pass',
    identity,
    location,
    ['/bin/sh', '-c', 'echo $$; /bin/sleep 1 & wait'],
    10,
  );
  assert.equal(receipt.mode, 'tree');
  assert.equal(receipt.forkObserved, true);
  assert.equal(receipt.sessionEmptyAtExit, true);
  assert.equal(receipt.survivors, 0);
  assert.equal(receipt.escaped, 0);
  assert.equal(receipt.treeEmpty, true);
  assert.equal(receipt.timedOut, false);
  assert.equal(receipt.exitCode, 0);
  assert((receipt.maxSessionSize ?? 0) >= 2, `maxSessionSize ${receipt.maxSessionSize}`);
  // `.leader` lets a later reconcile name the session leader: "pid start-seconds.microseconds".
  const leaderStat = await lstat(join(location, '.leader'));
  assert(leaderStat.isFile());
  assert.equal(leaderStat.nlink, 1);
  assert.equal(leaderStat.mode & 0o777, 0o600);
  const leader = /^(\d+) (\d+)\.(\d{6})\n$/.exec(await readFile(join(location, '.leader'), 'utf8'));
  assert(leader, 'leader record format');
  assert.equal(leader[1], (await logLines(location))[0]);
  const startedAt = Number(leader[2]) * 1000;
  assert(startedAt >= startedMs - 5000 && startedAt <= Date.now() + 5000, `start ${startedAt}`);
});

test('execute-tree kills a child left alive when the leader exits and reports LIFETIME_UNKNOWN', async () => {
  const { identity, location } = await stage('tree-survivor');
  await assert.rejects(
    () =>
      ops.executeTree('tree-survivor', identity, location, ['/bin/sh', '-c', '/bin/sleep 32 & echo $!'], 10),
    /EXECUTOR_LIFETIME_UNKNOWN/,
  );
  const pid = remember(Number((await logLines(location))[0]), 'sleep 32');
  assert.equal(alive(pid), false, 'survivor must be killed before the helper returns');
  const receipt = await receiptOf('tree-survivor');
  assert.equal(receipt?.mode, 'tree');
  assert.equal(receipt?.sessionEmptyAtExit, false);
  assert((receipt?.survivors ?? 0) >= 1, `survivors ${receipt?.survivors}`);
  assert.equal(receipt?.treeEmpty, true);
});

test('execute-tree reports LIFETIME_UNKNOWN for an observed member that leaves the session', async () => {
  // Only an escape after the member was seen in the session can be detected; a descendant that
  // calls setsid() before the first observation stays invisible (documented residual).
  const { identity, location } = await stage('tree-escape');
  const script =
    "/usr/bin/perl -MPOSIX -e 'sleep 2; POSIX::setsid() > 0 or exit 9; sleep 33' & echo $!; /bin/sleep 4";
  await assert.rejects(
    () => ops.executeTree('tree-escape', identity, location, ['/bin/sh', '-c', script], 15),
    /EXECUTOR_LIFETIME_UNKNOWN/,
  );
  const pid = remember(Number((await logLines(location))[0]), 'sleep 2; POSIX::setsid()');
  assert.equal(alive(pid), false, 'escaped member must be killed');
  const receipt = await receiptOf('tree-escape');
  assert.equal(receipt?.mode, 'tree');
  assert.equal(receipt?.sessionEmptyAtExit, true);
  assert.equal(receipt?.survivors, 0);
  assert((receipt?.escaped ?? 0) >= 1, `escaped ${receipt?.escaped}`);
});

test('execute-tree timeout kills the whole session and returns a proven-empty receipt', async () => {
  const { identity, location } = await stage('tree-timeout');
  const receipt = await ops.executeTree(
    'tree-timeout',
    identity,
    location,
    ['/bin/sh', '-c', '/bin/sleep 34 & echo $!; /bin/sleep 35'],
    1,
  );
  const pid = remember(Number((await logLines(location))[0]), 'sleep 34');
  assert.equal(receipt.mode, 'tree');
  assert.equal(receipt.timedOut, true);
  assert.equal(receipt.treeEmpty, true);
  assert.equal(alive(pid), false);
});

test('execute keeps installer semantics: fork stays UNKNOWN and no leader record is written', async () => {
  const { identity, location } = await stage('plain-fork');
  await assert.rejects(
    () => ops.execute('plain-fork', identity, location, ['/bin/sh', '-c', '/bin/true & wait'], 5),
    /EXECUTOR_LIFETIME_UNKNOWN/,
  );
  const receipt = await receiptOf('plain-fork');
  assert.equal(receipt?.forkObserved, true);
  assert.equal(receipt?.treeEmpty, false);
  assert.equal(receipt?.mode, undefined);
  await assert.rejects(() => lstat(join(location, '.leader')), { code: 'ENOENT' });
});

test('a held operations guard yields EXECUTOR_BUSY before any process or stage write', async () => {
  const { identity, location } = await stage('busy');
  const holder = spawn(
    '/usr/bin/perl',
    [
      '-MFcntl=:flock',
      '-e',
      '$|=1; open(my $f, "<", $ARGV[0]) or die; flock($f, LOCK_EX) or die; print "LOCKED\\n"; sleep 36',
      join(path, '.operations.guard'),
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const closed = new Promise<void>((resolve) => holder.once('close', () => resolve()));
  try {
    remember(holder.pid as number, 'LOCKED');
    await new Promise<void>((resolve, reject) => {
      let out = '';
      holder.stdout.on('data', (b) => {
        out += b.toString();
        if (out.includes('LOCKED')) resolve();
      });
      holder.once('close', (code) => reject(new Error(`lock holder exited ${code}`)));
    });
    const command = ['/bin/sh', '-c', 'echo ran'];
    await assert.rejects(() => ops.execute('busy', identity, location, command, 5), /EXECUTOR_BUSY/);
    await assert.rejects(() => ops.executeTree('busy', identity, location, command, 5), /EXECUTOR_BUSY/);
    assert.equal(await receiptOf('busy'), null);
    assert.deepEqual(await readdir(location), ['.operation-owner']);
  } finally {
    holder.kill('SIGTERM');
    await closed;
  }
  // Nothing ran, so the stage is reclaimable at once instead of being retained as UNKNOWN.
  await ops.remove('stages', 'busy', identity);
  await assert.rejects(() => lstat(location), { code: 'ENOENT' });
});
