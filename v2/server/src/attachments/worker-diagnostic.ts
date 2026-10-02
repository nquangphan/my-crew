import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, open, readFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { DiagnosticReport } from './worker-runner.ts';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function deniedWrite(path: string): Promise<boolean> {
  try {
    const fd = await open(path, 'r+');
    await fd.close();
    return false;
  } catch {
    return true;
  }
}
async function absent(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch {
    return true;
  }
}
async function networkDenied(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '1.1.1.1', port: 80 });
    let done = false;
    const finish = (denied: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(denied);
    };
    socket.once('connect', () => finish(false));
    socket.once('error', () => finish(true));
    socket.setTimeout(500, () => finish(true));
  });
}
export async function diagnosticMain(): Promise<DiagnosticReport> {
  const canary = JSON.parse(await readFile('/input/canary.json', 'utf8')) as {
    scenario: string;
    foreignPath: string;
  };
  const checks: DiagnosticReport['checks'] = [];
  const check = (name: string, pass: boolean, evidence: unknown) =>
    checks.push({ name, status: pass ? 'pass' : 'fail', evidenceSha256: hash(evidence) });
  if (canary.scenario === 'stdout-bomb') {
    while (true) {
      if (!process.stdout.write(Buffer.alloc(65536, 65)))
        await new Promise<void>((resolve) => process.stdout.once('drain', resolve));
    }
  }
  if (canary.scenario === 'memory') {
    const buffers: Buffer[] = [];
    while (true) buffers.push(Buffer.alloc(16 * 1024 * 1024, 1));
  }
  if (canary.scenario === 'timeout') {
    await new Promise<void>(() => {
      setInterval(() => {}, 1000);
    });
  }
  if (canary.scenario === 'pids') {
    const children: ReturnType<typeof spawn>[] = [];
    let blocked = false;
    try {
      for (let i = 0; i < 40; i++) {
        const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)'], { stdio: 'ignore' });
        const failed = await new Promise<boolean>((resolve) => {
          child.once('error', () => resolve(true));
          child.once('spawn', () => resolve(false));
        });
        if (failed) {
          blocked = true;
          break;
        }
        children.push(child);
      }
    } finally {
      await Promise.all(
        children.map(
          (child) =>
            new Promise<void>((resolve) => {
              child.once('close', () => resolve());
              child.kill('SIGKILL');
            }),
        ),
      );
    }
    check('pids-limit', blocked, { spawned: children.length, blocked });
  } else {
    const bytes = await readFile('/input/original');
    check('selected-original-readable', bytes.equals(Buffer.from('original')), {
      bytes: bytes.length,
      sha256: hash([...bytes]),
    });
    const writable = await open('/output/diagnostic-probe.txt', 'wx', 0o600);
    try {
      await writable.writeFile('bounded-canary');
      await writable.sync();
    } finally {
      await writable.close();
    }
    check(
      'private-output-writable',
      (await readFile('/output/diagnostic-probe.txt', 'utf8')) === 'bounded-canary',
      { bytes: 14 },
    );
    await unlink('/output/diagnostic-probe.txt');
    const external = Object.entries(networkInterfaces()).filter(([key]) => key !== 'lo');
    check(
      'network-denied',
      external.length === 0 && (await networkDenied()),
      external.map(([key]) => key),
    );
    check(
      'foreign-host-unavailable',
      typeof canary.foreignPath === 'string' && (await absent(canary.foreignPath)),
      { foreignPathSha256: hash(canary.foreignPath) },
    );
    check('readonly-source', await deniedWrite('/extractor/src/attachments/worker-entry.ts'), {
      path: 'worker-entry',
    });
    check('readonly-original', await deniedWrite('/input/original'), { path: 'original' });
    // Only inside the owned Linux diagnostic container; keys, never values.
    const unexpected = (await readFile('/proc/self/environ', 'utf8'))
      .split('\0')
      .map((pair) => pair.split('=')[0] ?? '')
      .filter((key) => /DATABASE|TOKEN|SECRET|PASSWORD|API_KEY|WORKFLOW/i.test(key));
    check('no-credential-db-workflow-env', unexpected.length === 0, { unexpectedCount: unexpected.length });
    check('no-docker-socket', await absent('/var/run/docker.sock'), { path: 'docker-socket' });
    check('no-host-source', (await absent('/workspace')) && (await absent('/Users')), {
      paths: ['workspace', 'Users'],
    });
    check('nonroot', process.getuid?.() === 65532, { uid: process.getuid?.() });
    try {
      const canvas = createRequire(import.meta.url)('@napi-rs/canvas') as {
        createCanvas(w: number, h: number): { toBuffer(format: string): Buffer };
      };
      const png = canvas.createCanvas(1, 1).toBuffer('image/png');
      check('native-png-probe', png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), {
        pngSha256: hash([...png]),
        bytes: png.length,
      });
    } catch {
      check('native-png-probe', false, { code: 'WORKER_IMAGE_INCOMPATIBLE' });
    }
  }
  return { kind: 'diagnostic-report', imageDigest: '', sourceTreeSha256: '', checks };
}
