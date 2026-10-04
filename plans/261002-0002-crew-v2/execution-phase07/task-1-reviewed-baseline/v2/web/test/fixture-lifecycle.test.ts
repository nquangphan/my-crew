import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  type CleanupResult,
  closeOwnedResource,
  type OwnedResource,
  withFixture,
} from '../e2e/support/fixture.ts';

test('withFixture giữ API, web và DB riêng suốt callback rồi đóng đúng tài nguyên', async () => {
  let entered = false;
  let runError: unknown;
  try {
    await withFixture(async (handle) => {
      entered = true;
      assert.match(handle.apiOrigin, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.match(handle.webOrigin, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.match(handle.dbName, /^crew_v2_test_[0-9a-f]+$/);
      assert.ok(handle.ownerPassword.length >= 24);
      assert.ok(!JSON.stringify(handle).includes(handle.ownerPassword), 'Không serialize mật khẩu owner');
      assert.ok(
        handle.resources.some((resource) => resource.kind === 'database' && resource.id === handle.dbName),
      );
      assert.ok(handle.resources.some((resource) => resource.kind === 'container'));
      assert.ok(handle.resources.some((resource) => resource.kind === 'listener'));
      for (const resource of handle.resources) {
        assert.ok(resource.id && resource.ownershipNonce && resource.startIdentity);
      }
      assert.match(handle.containerImageDigest, /^sha256:[0-9a-f]{64}$/);
      assert.ok(handle.dbPort > 0 && ![5432, 55432].includes(handle.dbPort));
      console.log(
        'fixture-identities=' +
          JSON.stringify({
            containerName: handle.containerName,
            containerImageDigest: handle.containerImageDigest,
            dbPort: handle.dbPort,
            dbName: handle.dbName,
            apiOrigin: handle.apiOrigin,
            webOrigin: handle.webOrigin,
            registryPath: handle.registryPath,
            resources: handle.resources,
          }),
      );

      const page = await fetch(`${handle.webOrigin}/crew-v2/`, { signal: AbortSignal.timeout(10_000) });
      assert.equal(page.status, 200);
      const login = await fetch(`${handle.apiOrigin}/v2/auth/session`, {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: { origin: handle.webOrigin, 'content-type': 'application/json' },
        body: JSON.stringify({ password: handle.ownerPassword }),
      });
      assert.equal(login.status, 200);
      const loginBody = (await login.json()) as { owner?: { id?: string }; csrfToken?: string };
      assert.equal(loginBody.owner?.id, 'owner');
      assert.ok(loginBody.csrfToken);
      const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
      assert.ok(cookie, 'Login phải cấp cookie phiên');
      const current = await fetch(`${handle.apiOrigin}/v2/auth/session`, {
        headers: { cookie },
        signal: AbortSignal.timeout(10_000),
      });
      assert.equal(current.status, 200);
      const currentBody = (await current.json()) as { owner?: { id?: string }; csrfToken?: string };
      assert.equal(currentBody.owner?.id, 'owner');
      assert.equal(currentBody.csrfToken, loginBody.csrfToken);
      const proxied = await fetch(`${handle.webOrigin}/v2/auth/session`, {
        headers: { cookie },
        signal: AbortSignal.timeout(10_000),
      });
      assert.equal(proxied.status, 200, 'Vite phải proxy /v2 tới API thuộc cùng fixture');

      const first = await handle.close();
      const second = await handle.close();
      assert.deepEqual(second, first, 'close lặp phải idempotent');
      assert.ok(first.length >= handle.resources.length);
      assert.ok(first.every((result) => result.state === 'stopped' || result.state === 'removed'));
      console.log('fixture-cleanup=' + JSON.stringify(first));
    });
  } catch (error) {
    runError = error;
  }
  if (!entered && runError instanceof Error && runError.message !== 'FIXTURE_UNAVAILABLE') throw runError;
  assert.equal(entered, true, 'withFixture phải gọi callback với run thật trước khi đóng tài nguyên');
  if (runError) throw runError;
});

const ownedListener: OwnedResource = {
  kind: 'listener',
  id: 'listener-test-1',
  ownershipNonce: 'unit-run-1',
  startIdentity: 'pid-100-start-200',
};

test('unit: identity lạ giữ UNKNOWN và không gọi stop/remove', async () => {
  let stopped = 0;
  let removed = 0;
  let result: CleanupResult | undefined;
  try {
    result = await closeOwnedResource(ownedListener, {
      readStartIdentity: async () => 'pid-999-start-999',
      stop: async () => {
        stopped++;
        return true;
      },
      confirmStopped: async () => true,
      remove: async () => {
        removed++;
        return true;
      },
    });
  } catch (error) {
    if (!(error instanceof Error && error.message === 'FIXTURE_UNAVAILABLE')) throw error;
  }
  assert.deepEqual(result, { resourceId: ownedListener.id, state: 'unknown', reason: 'IDENTITY_MISMATCH' });
  assert.equal(stopped, 0);
  assert.equal(removed, 0);
});

test('unit: STOP chưa xác minh giữ UNKNOWN và không remove', async () => {
  let stopped = 0;
  let removed = 0;
  let result: CleanupResult | undefined;
  try {
    result = await closeOwnedResource(ownedListener, {
      readStartIdentity: async () => ownedListener.startIdentity,
      stop: async () => {
        stopped++;
        return true;
      },
      confirmStopped: async () => false,
      remove: async () => {
        removed++;
        return true;
      },
    });
  } catch (error) {
    if (!(error instanceof Error && error.message === 'FIXTURE_UNAVAILABLE')) throw error;
  }
  assert.deepEqual(result, { resourceId: ownedListener.id, state: 'unknown', reason: 'STOP_UNVERIFIED' });
  assert.equal(stopped, 1);
  assert.equal(removed, 0);
});

test('SIGTERM trên preview child đóng đúng run và xác minh STOP trước khi thoát', async () => {
  const webRoot = fileURLToPath(new URL('../', import.meta.url));
  const script = fileURLToPath(new URL('../scripts/e2e-fixture.ts', import.meta.url));
  const child = spawn(process.execPath, [script, '--preview'], {
    cwd: webRoot,
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=384' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout = child.stdout;
  const stderr = child.stderr;
  assert.ok(stdout && stderr, 'Preview child phải có stdout/stderr riêng');
  let output = '';
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const ready = new Promise<{
    registryPath: string;
    resources: OwnedResource[];
  }>((resolve, reject) => {
    stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = /^preview-ready=(.+)$/m.exec(output);
      if (match) {
        try {
          resolve(JSON.parse(match[1] ?? '') as { registryPath: string; resources: OwnedResource[] });
        } catch (error) {
          reject(error);
        }
      }
    });
    stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    void exited.then(({ code, signal }) =>
      reject(
        new Error(`PREVIEW_EXIT_BEFORE_READY:${String(code)}:${String(signal)}:${output.slice(-4_096)}`),
      ),
    );
  });
  const within = async <T>(pending: Promise<T>, milliseconds: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        pending,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error('PREVIEW_DEADLINE')), milliseconds);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const identity = await within(ready, 45_000);
    const container = identity.resources.find((resource) => resource.kind === 'container');
    assert.ok(container?.id && /^[0-9a-f]{64}$/.test(container.id));
    assert.ok(existsSync(identity.registryPath), 'Registry phải có trước SIGTERM');
    const processRecord = spawnSync('ps', ['-p', String(child.pid), '-o', 'pgid=,lstart='], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    assert.equal(processRecord.status, 0, 'Phải chụp group/start của preview child trước SIGTERM');
    console.log(
      'interrupt-ready=' +
        JSON.stringify({
          childPid: child.pid,
          processRecord: processRecord.stdout.trim(),
          registryPath: identity.registryPath,
          resources: identity.resources,
        }),
    );
    assert.equal(child.kill('SIGTERM'), true);
    const terminal = await within(exited, 15_000);
    assert.deepEqual(terminal, { code: 0, signal: null }, 'Preview child phải tự cleanup và thoát');
    const match = /^preview-cleanup=(.+)$/m.exec(output);
    assert.ok(match, 'Preview phải phát cleanup witness sau SIGTERM');
    console.log(`interrupt-cleanup=${match[1]}`);
    const results = JSON.parse(match[1] ?? '') as CleanupResult[];
    assert.ok(results.some((result) => result.resourceId === container.id && result.state === 'removed'));
    assert.ok(results.every((result) => result.state === 'removed' || result.state === 'stopped'));
    assert.equal(existsSync(identity.registryPath), false);
    const inspect = spawnSync('docker', ['container', 'inspect', container.id], { timeout: 20_000 });
    assert.equal(inspect.error, undefined, 'Docker inspect phải chạy thành công');
    assert.notEqual(inspect.status, 0, 'Container exact ID phải biến mất sau STOP xác minh');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      try {
        await within(exited, 5_000);
      } catch {
        child.kill('SIGKILL');
        await within(exited, 5_000);
      }
    }
  }
});
