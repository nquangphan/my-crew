import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { insertPairingCode } from '../../api/test/helpers/machines.js';
import { main } from '../src/cli.js';
import { homePaths, loadConfig } from '../src/config.js';
import { fixture, useApi } from './helpers/api.js';
import { git, makeRepo, tempDir } from './helpers/git.js';

const api = useApi();

function io(home: string) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      out: (l: string) => out.push(l),
      err: (l: string) => err.push(l),
      env: { ...process.env, CREW_HOME: home, CREW_TOKEN_STORE: 'file' },
    },
  };
}

describe('crewd CLI', () => {
  it('pairs, claims a project with its local folder, shows status and rotates the token', async () => {
    const f = await fixture(api);
    const home = tempDir('crewd-home-');
    const paths = homePaths(home);
    const code = await insertPairingCode(api.db);
    const t = io(home);
    expect(await main(['pair', '--code', code, '--api', f.server.url, '--name', 'cli-mac'], t.io)).toBe(0);
    const config = loadConfig(paths.config);
    expect(config).toMatchObject({ apiUrl: f.server.url, machineName: 'cli-mac' });
    const token = readFileSync(paths.tokenFile, 'utf8').trim();
    expect(token).toMatch(/^crew_mt_/);
    expect(readFileSync(paths.config, 'utf8')).not.toContain(token);

    // WEB belongs to the fixture machine: the claim waits for the owner.
    const repo = makeRepo();
    git(repo, 'remote', 'add', 'origin', 'https://github.com/2p/web-shop.git');
    expect(await main(['project', 'add', '--key', 'WEB', '--path', repo, '--branch', 'main'], t.io)).toBe(0);
    expect(t.out.join('\n')).toContain('chờ chủ dự án duyệt');
    expect(loadConfig(paths.config).projects).toEqual([
      expect.objectContaining({ key: 'WEB', repoPath: repo, defaultBranch: 'main' }),
    ]);

    // A new project from the folder: owned at once.
    const other = makeRepo();
    git(other, 'remote', 'add', 'origin', 'https://github.com/2p/new-app.git');
    expect(
      await main(
        [
          'project',
          'create',
          '--key',
          'APP',
          '--name',
          'App mới',
          '--description',
          'Ứng dụng mới',
          '--platform',
          'backend',
          '--path',
          other,
        ],
        t.io,
      ),
    ).toBe(0);
    expect(t.out.join('\n')).toContain('Đã tạo project APP');

    expect(await main(['status'], t.io)).toBe(0);
    expect(t.out.join('\n')).toContain('Daemon: không chạy');

    expect(await main(['rotate-token'], t.io)).toBe(0);
    expect(readFileSync(paths.tokenFile, 'utf8').trim()).not.toBe(token);

    expect(await main(['project', 'release', '--key', 'APP'], t.io)).toBe(0);
    expect(loadConfig(paths.config).projects.map((p) => p.key)).toEqual(['WEB']);
  });

  it('prints usage errors with exit code 2', async () => {
    const home = tempDir('crewd-home-');
    const t = io(home);
    expect(await main(['nope'], t.io)).toBe(2);
    expect(await main(['pair'], t.io)).toBe(2);
    expect(t.err.join('\n')).toContain('thiếu --code');
    expect(await main(['status'], t.io)).toBe(1);
    expect(existsSync(homePaths(home).config)).toBe(false);
  });
});
