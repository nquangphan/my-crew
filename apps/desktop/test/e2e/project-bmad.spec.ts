import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { BMAD_6_12 } from '../../../daemon/test/fixtures/bmad-installs';
import { E2E_API_URL } from './e2e-env';
import { call, fixtureRepo, launch, machineIdOf, ownerWeb, pairingCode, testEnv } from './helpers';

const REPO_URL = 'https://github.com/2p/bmad-fixture.git';

test('"Cài BMAD" asked for from the web installs the reported profile only into a folder without BMAD (stand-in installer)', async () => {
  const env = testEnv();
  const { app, page } = await launch(env);
  try {
    const repo = fixtureRepo(env, 'bmad-fixture', REPO_URL);
    // The folder has a BMAD install: the machine reports it as the project's profile when it probes.
    for (const [path, content] of Object.entries(BMAD_6_12)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), content);
    }
    await call(page, 'setup.pair', { apiUrl: E2E_API_URL, code: pairingCode(8), machineName: 'mac-bmad' });
    const web = await ownerWeb();
    const machineId = machineIdOf(env);
    const project = await web.createProject({
      key: 'BMAD',
      name: 'BMAD fixture',
      repoUrl: REPO_URL,
      platform: 'backend',
    });
    await web.assign(machineId, { projectId: project.id });
    expect((await call(page, 'projects.setFolder', { key: 'BMAD', path: repo })).ok).toBe(true);
    await call(page, 'setup.finish', {});

    // A folder that already has BMAD is never reinstalled or updated.
    await expect
      .poll(
        async () => {
          const res = await web.request('GET', '/v1/projects');
          const items = ((await res.json()) as { items: { key: string; bmadProfile: unknown }[] }).items;
          return items.find((item) => item.key === 'BMAD')?.bmadProfile !== null;
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    const skipped = await web.command(machineId, { action: 'bmad.install', projectKey: 'BMAD' });
    expect(skipped).toMatchObject({
      status: 'done',
      result: { status: 'skipped', message: 'Máy này đã có BMAD 6.12.0; không cài lại.' },
    });

    // Without the local install, the owner's click on the web installs the profile here (the test seam
    // stands in for npx) and commits nothing.
    rmSync(join(repo, '_bmad'), { recursive: true, force: true });
    const installed = await web.command(machineId, { action: 'bmad.install', projectKey: 'BMAD' });
    expect(installed.status).toBe('done');
    expect((installed.result as { message: string }).message).toMatch(/Đã cài BMAD 6\.12\.0/);
    expect((installed.result as { message: string }).message).toMatch(/vùng luật R6 bảo vệ/);
    expect(existsSync(join(repo, '_bmad', '_config', 'manifest.yaml'))).toBe(true);
  } finally {
    await app.close();
    env.cleanup();
  }
});
