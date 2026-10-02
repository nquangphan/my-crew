import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const name = `crew-v2-test-${randomUUID()}`;
let containerId = '';
let child: ReturnType<typeof spawn> | undefined;
let interrupted: 'SIGINT' | 'SIGTERM' | undefined;
let wakeInterruption: (() => void) | undefined;
const interruption = new Promise<void>((resolve) => {
  wakeInterruption = resolve;
});

function signalOwnTestGroup(signal: NodeJS.Signals): void {
  if (!child?.pid) return;
  try {
    // The detached node --test process owns this group; descendants inherit it.
    process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

async function docker(...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    if (!process.stdout || !process.stderr) {
      process.kill();
      reject(new Error('DOCKER_PIPE_UNAVAILABLE'));
      return;
    }
    process.stdout.on('data', (chunk) => (stdout += chunk));
    process.stderr.on('data', (chunk) => (stderr += chunk));
    process.on('error', reject);
    process.on('close', (code) =>
      code === 0 ? resolve(stdout.trim()) : reject(new Error(`docker ${args[0]}: ${stderr.trim()}`)),
    );
  });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (interrupted) return;
    interrupted = signal;
    wakeInterruption?.();
  });
}

try {
  containerId = await docker(
    'run',
    '--rm',
    '-d',
    '--name',
    name,
    '-e',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    '-e',
    'POSTGRES_DB=crew_v2_test',
    '-p',
    '127.0.0.1::5432',
    'postgres:18.6',
  );
  const mapping = await docker('port', containerId, '5432/tcp');
  const match = /^127\.0\.0\.1:(\d+)$/.exec(mapping);
  if (!match) throw new Error(`UNSAFE_TEST_DB_MAPPING: ${mapping}`);
  const port = Number(match[1]);
  if ([5432, 55432].includes(port)) throw new Error('SHARED_DB_PORT');
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (interrupted) throw new Error('INTERRUPTED');
    try {
      await docker('exec', containerId, 'pg_isready', '-U', 'postgres', '-d', 'crew_v2_test');
      ready = true;
      break;
    } catch {
      await delay(500);
    }
  }
  if (interrupted) throw new Error('INTERRUPTED');
  if (!ready) throw new Error('TEST_DB_NOT_READY');
  const forwarded = process.argv.slice(2);
  const explicitIndex = forwarded.indexOf('--test-file');
  let files: string[];
  if (explicitIndex >= 0) {
    const file = forwarded[explicitIndex + 1];
    if (
      !file ||
      !isAbsolute(file) ||
      !/\.test\.(?:ts|mjs)$/.test(file) ||
      forwarded.indexOf('--test-file', explicitIndex + 1) >= 0
    )
      throw new Error('TEST_FILE_INVALID');
    files = [file];
    forwarded.splice(explicitIndex, 2);
  } else {
    files = (await readdir(new URL('../test/', import.meta.url)))
      .filter((file) => file.endsWith('.test.ts'))
      .sort()
      .map((file) => `test/${file}`);
  }
  const args = ['--test', ...forwarded, ...files];
  child = spawn(process.execPath, args, {
    detached: process.platform !== 'win32',
    stdio: 'inherit',
    env: {
      ...process.env,
      CREW_V2_TEST_DATABASE_URL: `postgres://postgres@127.0.0.1:${port}/crew_v2_test`,
      CREW_V2_TEST_CONTAINER_ID: containerId,
    },
  });
  const testChild = child;
  const childExit = new Promise<number>((resolve, reject) => {
    testChild.on('error', reject);
    testChild.on('close', (code, signal) =>
      resolve(signal ? 128 + (signal === 'SIGINT' ? 2 : 15) : (code ?? 1)),
    );
  });
  const first = await Promise.race([
    childExit.then((code) => ({ kind: 'exit' as const, code })),
    interruption.then(() => ({ kind: 'interrupt' as const })),
  ]);
  if (interrupted) {
    signalOwnTestGroup(interrupted);
    await delay(750);
    signalOwnTestGroup('SIGKILL');
    const reaped = await Promise.race([childExit.then(() => true), delay(750).then(() => false)]);
    if (!reaped) {
      console.error('TEST_CHILD_REAP_TIMEOUT');
      process.exitCode = 1;
    } else {
      process.exitCode = interrupted === 'SIGINT' ? 130 : 143;
    }
  } else if (first.kind === 'exit') {
    process.exitCode = first.code;
  }
} catch (error) {
  console.error(error);
  process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : 1;
} finally {
  if (containerId) {
    try {
      await docker('stop', containerId);
    } catch (error) {
      console.error('TEST_DB_CLEANUP_FAILED', error);
      process.exitCode = 1;
    }
  }
}
