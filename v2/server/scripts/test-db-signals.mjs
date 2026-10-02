import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('../', import.meta.url));
const signal = process.argv[2] === 'SIGINT' ? 'SIGINT' : 'SIGTERM';
const pauseChild = process.argv.includes('--pause-child');
const scratch = mkdtempSync(join(tmpdir(), 'crew-v2-signal-probe-'));
const ready = join(scratch, 'ready');
const signalAck = join(scratch, 'signal-ack');
const nodeTestPidFile = join(scratch, 'node-test-pid');
const descendantPidFile = join(scratch, 'descendant-pid');
const preload = join(scratch, 'preload.mjs');
const testFile = join(scratch, 'runner-stubborn.test.mjs');
let runner;
let nodeTestPid;
let containerId;

function ownContainerRunning(id) {
  try {
    return (
      execFileSync('docker', ['inspect', '--format', '{{.State.Running}}', id], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() === 'true'
    );
  } catch {
    return false;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFile(path, timeoutMs) {
  if (existsSync(path)) return;
  await new Promise((resolveReady, reject) => {
    const watcher = watch(scratch, (_event, file) => {
      if (file === path.split('/').at(-1) && existsSync(path)) finish();
    });
    const timer = setTimeout(() => finish(new Error(`probe file timed out: ${path}`)), timeoutMs);
    function finish(error) {
      clearTimeout(timer);
      watcher.close();
      error ? reject(error) : resolveReady();
    }
    if (existsSync(path)) finish();
  });
}

function waitClose(child, ms) {
  return new Promise((resolveWait) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolveWait(true);
    const timer = setTimeout(() => resolveWait(false), ms);
    child.once('close', () => {
      clearTimeout(timer);
      resolveWait(true);
    });
  });
}

writeFileSync(
  preload,
  `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.CREW_PROBE_NODE_TEST_PID_FILE, String(process.pid));
const acknowledge = () => writeFileSync(process.env.CREW_PROBE_SIGNAL_ACK_FILE, String(process.pid));
process.on('SIGTERM', acknowledge); process.on('SIGINT', acknowledge);
setInterval(() => {}, 1000);\n`,
);
writeFileSync(
  testFile,
  `
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
test('runner stubborn signal probe', async () => {
  process.on('SIGTERM', () => {});
  process.on('SIGINT', () => {});
  const descendant = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});setInterval(()=>{},1000);process.send?.('ready')"],
    { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  await once(descendant, 'message');
  writeFileSync(process.env.CREW_PROBE_DESCENDANT_PID_FILE, String(descendant.pid));
  writeFileSync(process.env.CREW_PROBE_READY_FILE, JSON.stringify({
    containerId: process.env.CREW_V2_TEST_CONTAINER_ID,
    descendantPid: descendant.pid,
  }));
  await new Promise(() => {});
});
`,
);

try {
  runner = spawn(
    process.execPath,
    [
      process.env.CREW_V2_PROBE_RUNNER ?? 'scripts/test-db.ts',
      '--test-isolation=none',
      `--import=${preload}`,
      '--test-name-pattern=runner stubborn signal probe',
      '--test-file',
      testFile,
    ],
    {
      cwd: server,
      stdio: 'ignore',
      env: {
        ...process.env,
        CREW_PROBE_READY_FILE: ready,
        CREW_PROBE_DESCENDANT_PID_FILE: descendantPidFile,
        CREW_PROBE_SIGNAL_ACK_FILE: signalAck,
        CREW_PROBE_NODE_TEST_PID_FILE: nodeTestPidFile,
      },
    },
  );
  const readyOrExit = await Promise.race([
    waitFile(ready, 15000).then(() => 'ready'),
    once(runner, 'close').then(() => 'exit'),
  ]);
  if (readyOrExit === 'exit') throw new Error('runner exited before explicit scratch test became ready');
  const fixture = JSON.parse(readFileSync(ready, 'utf8'));
  containerId = fixture.containerId;
  nodeTestPid = Number(readFileSync(nodeTestPidFile, 'utf8'));
  if (
    !/^[0-9a-f]{64}$/.test(containerId) ||
    !Number.isSafeInteger(nodeTestPid) ||
    !ownContainerRunning(containerId)
  )
    throw new Error('probe own child/container not observed');
  if (pauseChild) process.kill(nodeTestPid, 'SIGSTOP');
  const signaledAt = Date.now();
  runner.kill(signal);
  if (!pauseChild) {
    await waitFile(signalAck, 1000);
    const acknowledgingPid = Number(readFileSync(signalAck, 'utf8'));
    if (acknowledgingPid !== nodeTestPid)
      throw new Error(`signal received by ${acknowledgingPid}, direct child was ${nodeTestPid}`);
  }
  const closed = await waitClose(runner, Math.max(0, 4000 - (Date.now() - signaledAt)));
  const descendantPid = Number(fixture.descendantPid);
  const containerStopped = !ownContainerRunning(containerId);
  if (!closed || !containerStopped || alive(descendantPid) || alive(nodeTestPid)) {
    throw new Error(
      `cleanup failed: closed=${closed}, containerStopped=${containerStopped}, descendantAlive=${alive(descendantPid)}, testChildAlive=${alive(nodeTestPid)}`,
    );
  }
  console.log(
    `${signal}${pauseChild ? ' paused' : ''} cleanup PASS: runner, child, descendant, and own container stopped within 4s`,
  );
} finally {
  if (!containerId && existsSync(ready)) {
    try {
      const reported = JSON.parse(readFileSync(ready, 'utf8')).containerId;
      if (/^[0-9a-f]{64}$/.test(reported)) containerId = reported;
    } catch {}
  }
  if (!nodeTestPid && existsSync(nodeTestPidFile)) {
    const reported = Number(readFileSync(nodeTestPidFile, 'utf8'));
    if (Number.isSafeInteger(reported) && reported > 1) nodeTestPid = reported;
  }
  if (runner && alive(runner.pid)) {
    runner.kill('SIGTERM');
    await waitClose(runner, 2500);
  }
  if (nodeTestPid)
    try {
      process.kill(nodeTestPid, 'SIGKILL');
    } catch {}
  if (existsSync(descendantPidFile))
    try {
      process.kill(Number(readFileSync(descendantPidFile, 'utf8')), 'SIGKILL');
    } catch {}
  if (runner && alive(runner.pid)) {
    await waitClose(runner, 500);
    if (alive(runner.pid)) runner.kill('SIGKILL');
  }
  if (containerId && ownContainerRunning(containerId))
    try {
      execFileSync('docker', ['stop', containerId]);
    } catch {}
  rmSync(testFile, { force: true });
  rmSync(scratch, { recursive: true, force: true });
}
