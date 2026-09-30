import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { collectFiles, createRuntimeRelease, runtimeConfig } from '../../scripts/runtime-bundle.mjs';
import { E2E_API_URL, e2eRuntimeKey, STAGED_APP } from './e2e-env';
import { appInfo, call, launch, machineIdOf, ownerWeb, pairingCode, testEnv } from './helpers';

/**
 * A runtime built from the staged app's own runtime, with markers: the host writes its version to a file in the
 * crew home when it loads, and the renderer carries a meta tag. `crash` makes a host that exits at once.
 */
function markedRuntime(version: string, options: { crash?: boolean } = {}) {
  const files = collectFiles(join(STAGED_APP, 'out', 'runtime'));
  const host = files.get('host/index.js')?.toString('utf8') ?? '';
  const marker = `import { appendFileSync as crewE2eAppend } from 'node:fs';\ncrewE2eAppend(\`\${process.env.CREW_HOME}/.e2e-host-runtime\`, '${version}\\n');\n`;
  files.set('host/index.js', Buffer.from(options.crash ? `${marker}process.exit(3);\n` : `${marker}${host}`));
  const html = files.get('renderer/index.html')?.toString('utf8') ?? '';
  files.set(
    'renderer/index.html',
    Buffer.from(html.replace('<head>', `<head><meta name="crew-runtime-e2e" content="${version}">`)),
  );
  return files;
}

test('a signed runtime published on the server reaches the running app, which switches without reinstalling and rolls back a runtime that cannot start', async () => {
  const key = e2eRuntimeKey();
  const env = testEnv();
  env.env.CREW_RUNTIME_TEST_KEYS = key.publicKey;
  env.env.CREW_RUNTIME_PROBATION_MS = '15000';
  const { app, page } = await launch(env);
  const appPid = app.process().pid;
  try {
    await call(page, 'setup.pair', { apiUrl: E2E_API_URL, code: pairingCode(9), machineName: 'mac-runtime' });
    await call(page, 'setup.finish', {});
    await page.evaluate(() => {
      window.location.hash = '#/status';
    });
    await page.reload();
    const { version: builtin, shellRange } = runtimeConfig();
    await expect(page.locator(`[data-runtime-version="${builtin}"]`)).toBeVisible({ timeout: 60_000 });
    const web = await ownerWeb();
    const machineId = machineIdOf(env);
    // The machine reports its app and runtime versions to the web.
    await expect
      .poll(async () => (await web.machine('mac-runtime'))?.runtime.reported, { timeout: 60_000 })
      .toMatchObject({ version: builtin, source: 'builtin' });

    // Publish a signed runtime on the server: the app hears runtime.published, downloads, verifies, switches.
    const publish = async (version: string, crash = false) => {
      const files = markedRuntime(version, { crash });
      const staged = join(env.root, `runtime-${version}`);
      for (const [path, data] of files) {
        mkdirSync(join(staged, ...path.split('/').slice(0, -1)), { recursive: true });
        writeFileSync(join(staged, ...path.split('/')), data);
      }
      const release = createRuntimeRelease({
        runtimeDir: staged,
        version,
        shellRange,
        signingKey: key.privateKey,
      });
      const res = await web.request('POST', '/v1/runtime/releases', {
        manifest: release.manifest,
        signature: release.signature,
        bundle: release.bundle.toString('base64'),
      });
      expect(res.status, await res.clone().text()).toBe(201);
    };
    const next = '0.3.50';
    await publish(next);
    await expect(page.locator(`[data-runtime-version="${next}"]`)).toBeVisible({ timeout: 120_000 });
    // The window now runs the new renderer, the host the new host code, from ~/.crew/runtime/<version>.
    await expect(page.locator('meta[name="crew-runtime-e2e"]')).toHaveAttribute('content', next);
    expect(page.url()).toContain(`/crew/runtime/${next}/renderer/index.html`);
    await expect.poll(() => readMarker(env.home)).toContain(next);
    // Same app process: nothing was reinstalled or relaunched; the daemon runs again on the new host.
    expect(app.process().pid).toBe(appPid);
    await expect(async () => expect((await appInfo(page)).daemon.daemonStarted).toBe(true)).toPass({
      timeout: 60_000,
    });
    await expect
      .poll(async () => (await web.machine('mac-runtime'))?.runtime.reported, { timeout: 60_000 })
      .toMatchObject({ version: next, source: 'installed', state: 'idle' });

    // A runtime whose host cannot start is rolled back automatically, and the web sees why.
    await publish('0.3.51', true);
    await expect(async () =>
      expect((await appInfo(page)).runtime).toMatchObject({
        state: 'rolled_back',
        version: next,
        target: '0.3.51',
      }),
    ).toPass({ timeout: 120_000 });
    await expect(page.locator('[data-runtime-state="rolled_back"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('meta[name="crew-runtime-e2e"]')).toHaveAttribute('content', next);
    await expect(async () => expect((await appInfo(page)).daemon.daemonStarted).toBe(true)).toPass({
      timeout: 60_000,
    });
    await expect
      .poll(async () => (await web.machine('mac-runtime'))?.runtime.reported, { timeout: 60_000 })
      .toMatchObject({ version: next, state: 'rolled_back', target: '0.3.51' });
    expect(app.process().pid).toBe(appPid);
    expect(machineId).not.toBe('');
  } finally {
    await app.close();
    env.cleanup();
  }
});

function readMarker(home: string): string {
  const file = join(home, '.e2e-host-runtime');
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}
