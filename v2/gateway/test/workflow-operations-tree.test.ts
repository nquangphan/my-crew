import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmod, lstat, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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
const markers: string[] = [];

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
/** Registers an argv marker unique to this file before any process carrying it starts. */
function own(marker: string): string {
  markers.push(marker);
  return marker;
}
/** Processes whose argv contains a marker; used where pids change (fork chains). */
function marked(marker: string): number[] {
  return execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.includes(marker) && !line.includes('/bin/ps'))
    .map((line) => Number(line.trim().split(/\s+/)[0]));
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
  for (const marker of markers) for (const pid of marked(marker)) process.kill(pid, 'SIGKILL');
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
  // `receipts/{id}.leader` names the session leader for reconcile: "pid start-seconds.microseconds".
  // It lives outside the stage, which the child can write.
  const leaderPath = join(path, 'receipts', 'tree-pass.leader');
  const leaderStat = await lstat(leaderPath);
  assert(leaderStat.isFile());
  assert.equal(leaderStat.nlink, 1);
  assert.equal(leaderStat.mode & 0o777, 0o600);
  await assert.rejects(() => lstat(join(location, '.leader')), { code: 'ENOENT' });
  const leader = /^(\d+) (\d+)\.(\d{6})\n$/.exec(await readFile(leaderPath, 'utf8'));
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
  await assert.rejects(() => lstat(join(path, 'receipts', 'plain-fork.leader')), { code: 'ENOENT' });
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
    await assert.rejects(() => lstat(join(path, 'receipts', 'busy.leader')), { code: 'ENOENT' });
    assert.deepEqual(await readdir(location), ['.operation-owner']);
  } finally {
    holder.kill('SIGTERM');
    await closed;
  }
  // Nothing ran, so the stage is reclaimable at once instead of being retained as UNKNOWN.
  await ops.remove('stages', 'busy', identity);
  await assert.rejects(() => lstat(location), { code: 'ENOENT' });
});

test('the leader record outside the stage is unaffected by a child that writes .leader in the stage', async () => {
  const { identity, location } = await stage('tree-forged-leader');
  await ops.executeTree(
    'tree-forged-leader',
    identity,
    location,
    ['/bin/sh', '-c', "echo $$; printf '1 0.000000\\n' > .leader"],
    10,
  );
  assert.equal(await readFile(join(location, '.leader'), 'utf8'), '1 0.000000\n');
  const leader = /^(\d+) /.exec(await readFile(join(path, 'receipts', 'tree-forged-leader.leader'), 'utf8'));
  assert.equal(leader?.[1], (await logLines(location))[0]);
});

test('execute-tree exits 36 without running anything when the leader record cannot be written', async () => {
  const { identity, location } = await stage('tree-no-leader');
  await writeFile(join(path, 'receipts', 'tree-no-leader.leader'), 'occupied\n', { mode: 0o600 });
  await assert.rejects(
    () => ops.executeTree('tree-no-leader', identity, location, ['/bin/sh', '-c', 'echo ran'], 5),
    /EXECUTOR_RECEIPT_MISSING/,
  );
  assert.equal(await receiptOf('tree-no-leader'), null);
  assert.deepEqual(await readdir(location), ['.operation-owner']);
});

test('a fork chain that outruns per-pid listing is still a survivor: UNKNOWN and nothing left running', async () => {
  // The chain moves to its own process group, is observed there, then hops: each hop forks and the
  // parent exits at once, so a pid listed in one snapshot may be gone when it is checked. The leader
  // exits mid-chain; the result must never be PASS and the whole group must be killed.
  const marker = own('crew_s6b_tree_hopper');
  const { identity, location } = await stage('tree-hopper');
  const script = `/usr/bin/perl -e 'setpgrp(0, 0); select(undef, undef, undef, 1.5); for (1..2000) { my $p = fork; exit 0 if $p; last unless defined $p } sleep 30' ${marker} & /bin/sleep 2`;
  await assert.rejects(
    () => ops.executeTree('tree-hopper', identity, location, ['/bin/sh', '-c', script], 15),
    /EXECUTOR_LIFETIME_UNKNOWN/,
  );
  assert.deepEqual(marked(marker), []);
  const receipt = await receiptOf('tree-hopper');
  assert.equal(receipt?.sessionEmptyAtExit, false);
  // treeEmpty is not asserted: hops can exhaust the cumulative 256-member watch cap, which fails closed.
});

test('a timeout with an escaped member is UNKNOWN, not a reclaimable timeout receipt', async () => {
  const marker = own('crew_s6b_tree_timeout_escape');
  const { identity, location } = await stage('tree-timeout-escape');
  own('sleep 30.0143');
  const script = `/usr/bin/perl -MPOSIX -e 'sleep 1; POSIX::setsid() > 0 or exit 9; sleep 30' ${marker} & /bin/sleep 30.0143`;
  await assert.rejects(
    () => ops.executeTree('tree-timeout-escape', identity, location, ['/bin/sh', '-c', script], 3),
    /EXECUTOR_LIFETIME_UNKNOWN/,
  );
  const receipt = await receiptOf('tree-timeout-escape');
  assert.equal(receipt?.timedOut, true);
  assert((receipt?.escaped ?? 0) >= 1, `escaped ${receipt?.escaped}`);
  assert.deepEqual(marked(marker), []);
  assert.deepEqual(marked('sleep 30.0143'), []);
});

test('a grandchild that leaves the session soon after its fork is observed through member NOTE_FORK', async () => {
  // Without a fork watch on members the grandchild lives in the session between two 1-second ticks.
  const marker = own('crew_s6b_tree_grandchild');
  const { identity, location } = await stage('tree-grandchild');
  const script = `/usr/bin/perl -MPOSIX -MTime::HiRes=sleep -e 'sleep 1.5; if (fork == 0) { sleep 0.3; POSIX::setsid(); sleep 30; exit } sleep 2' ${marker} & /bin/sleep 5`;
  await assert.rejects(
    () => ops.executeTree('tree-grandchild', identity, location, ['/bin/sh', '-c', script], 15),
    /EXECUTOR_LIFETIME_UNKNOWN/,
  );
  const receipt = await receiptOf('tree-grandchild');
  assert((receipt?.escaped ?? 0) >= 1, `escaped ${receipt?.escaped}`);
  assert.deepEqual(marked(marker), []);
});

test('a session above 256 members fails closed and kills members in other groups and escaped ones', async () => {
  const group = own('crew_s6b_tree_own_group');
  const escapee = own('crew_s6b_tree_overflow_escape');
  const { identity, location } = await stage('tree-overflow');
  own('sleep 30.0257');
  const script = [
    `/usr/bin/perl -e 'setpgrp(0, 0); sleep 30' ${group} &`,
    `/usr/bin/perl -MPOSIX -e 'sleep 1; POSIX::setsid() > 0 or exit 9; sleep 30' ${escapee} &`,
    '/bin/sleep 2.5',
    'i=0; while [ $i -lt 300 ]; do /bin/sleep 30.0257 & i=$((i+1)); done; wait',
  ].join('\n');
  await assert.rejects(
    () => ops.executeTree('tree-overflow', identity, location, ['/bin/sh', '-c', script], 30),
    /EXECUTOR_RECEIPT_MISSING/,
  );
  assert.equal(await receiptOf('tree-overflow'), null);
  assert.deepEqual(marked(group), []);
  assert.deepEqual(marked(escapee), []);
  assert.deepEqual(marked('sleep 30.0257'), []);
});

test('an invalid operations guard is EXECUTOR_GUARD_INVALID, distinct from a busy guard', async () => {
  const { identity, location } = await stage('guard-invalid');
  const guard = join(path, '.operations.guard');
  await chmod(guard, 0o644);
  try {
    const command = ['/bin/sh', '-c', 'echo ran'];
    await assert.rejects(
      () => ops.execute('guard-invalid', identity, location, command, 5),
      /EXECUTOR_GUARD_INVALID/,
    );
    await assert.rejects(
      () => ops.executeTree('guard-invalid', identity, location, command, 5),
      /EXECUTOR_GUARD_INVALID/,
    );
    assert.deepEqual(await readdir(location), ['.operation-owner']);
  } finally {
    await chmod(guard, 0o600);
  }
});

test('a fork chain inside the leader group is caught by the kernel group check every time', async () => {
  // kill(-group, 0) walks the group under its lock, so the chain cannot slip between listing and getsid().
  const marker = own('crew_s6b_tree_leader_group_hopper');
  for (const run of [1, 2, 3]) {
    const id = `tree-leader-hopper-${run}`;
    const { identity, location } = await stage(id);
    const script = `/usr/bin/perl -e 'for (1..1500) { my $p = fork; exit 0 if $p; last unless defined $p } sleep 30' ${marker} &`;
    await assert.rejects(
      () => ops.executeTree(id, identity, location, ['/bin/sh', '-c', script], 15),
      /EXECUTOR_LIFETIME_UNKNOWN/,
    );
    const receipt = await receiptOf(id);
    assert.equal(receipt?.sessionEmptyAtExit, false, `run ${run}`);
    assert((receipt?.survivors ?? 0) >= 1, `run ${run} survivors ${receipt?.survivors}`);
    assert.deepEqual(marked(marker), [], `run ${run}`);
  }
});

test('a learned process group that emptied is pruned and does not block PASS', async () => {
  const { identity, location } = await stage('tree-group-pruned');
  const receipt = await ops.executeTree(
    'tree-group-pruned',
    identity,
    location,
    ['/bin/sh', '-c', "/usr/bin/perl -e 'setpgrp(0, 0); sleep 2' & wait"],
    10,
  );
  assert.equal(receipt.sessionEmptyAtExit, true);
  assert.equal(receipt.escaped, 0);
  // Only the leader's own group is still held: the member's group was learned, emptied and pruned.
  assert.equal(receipt.groupsKnown, 1);
});
