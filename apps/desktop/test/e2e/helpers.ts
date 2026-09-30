import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AppInfo,
  CSRF_HEADER,
  type DesktopInput,
  type DesktopMethod,
  type DesktopOutput,
  type Machine,
  type MachineCommand,
} from '@crew/shared';
import { _electron, type ElectronApplication, expect, type Page } from '@playwright/test';
import { E2E_API_URL, E2E_STATE_FILE, type E2eState, STAGED_APP } from './e2e-env';

export const state = (): E2eState => JSON.parse(readFileSync(E2E_STATE_FILE, 'utf8')) as E2eState;

/** Single-use pairing codes from the prepared pool; each spec uses its own indexes. */
export function pairingCode(index: number): string {
  const code = state().pairingCodes[index];
  if (!code) throw new Error(`no pairing code #${index}`);
  return code;
}

export interface TestEnv {
  root: string;
  home: string;
  env: Record<string, string>;
  cleanup: () => void;
}

/**
 * A throwaway machine: its own crew home and Electron user data, an isolated git config, and a fake `claude`
 * CLI first on PATH (records `claude mcp add`, answers `--version`). No Keychain, login item or Terminal is
 * touched (test mode).
 */
export function testEnv(): TestEnv {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'crew-desktop-e2e-')));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'claude'),
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.300 (Claude Code)"; exit 0; fi\necho "$@" >> "${join(root, 'claude-calls')}"\n`,
  );
  chmodSync(join(bin, 'claude'), 0o755);
  const gitconfig = join(root, 'gitconfig');
  writeFileSync(
    gitconfig,
    '[user]\n\tname = Crew E2E\n\temail = crew-e2e@example.invalid\n[init]\n\tdefaultBranch = main\n',
  );
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ANTHROPIC_API_KEY' && !key.startsWith('ELECTRON_')) env[key] = value;
  }
  Object.assign(env, {
    CREW_HOME: join(root, 'crew'),
    CREW_DESKTOP_USER_DATA: join(root, 'user-data'),
    CREW_DESKTOP_TEST_MODE: '1',
    CREW_TOKEN_STORE: 'file',
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  });
  return {
    root,
    home: join(root, 'crew'),
    env,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * A project checkout: fetch URL = the project's repo URL, pushes go to a local bare repo. `docs: false` makes
 * a repo that has not adopted the docs standard yet (no `docs/flows.yaml`).
 */
export function fixtureRepo(
  env: TestEnv,
  name: string,
  repoUrl: string,
  options: { docs?: boolean } = {},
): string {
  const repo = join(env.root, name);
  const bare = join(env.root, `${name}.git`);
  const run = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, env: { ...process.env, ...env.env }, stdio: 'pipe' });
  mkdirSync(repo, { recursive: true });
  mkdirSync(bare);
  run(bare, 'init', '-q', '--bare', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), `# ${name}\n`);
  if (options.docs !== false) {
    mkdirSync(join(repo, 'docs'));
    writeFileSync(join(repo, 'docs', 'flows.yaml'), 'version: 1\n');
  }
  run(repo, 'init', '-q', '-b', 'main');
  run(repo, 'add', '-A');
  run(repo, 'commit', '-q', '-m', 'init');
  run(repo, 'remote', 'add', 'origin', repoUrl);
  run(repo, 'remote', 'set-url', '--push', 'origin', bare);
  return repo;
}

export async function launch(env: TestEnv): Promise<{ app: ElectronApplication; page: Page }> {
  // CREW_E2E_EXECUTABLE runs the suite against a packaged app (…/2P Crew.app/Contents/MacOS/2P Crew).
  const packaged = process.env.CREW_E2E_EXECUTABLE;
  const electron = packaged ?? (createRequire(import.meta.url)('electron') as unknown as string);
  const app = await _electron.launch({
    executablePath: electron,
    args: packaged ? [] : [STAGED_APP],
    env: env.env,
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

/** The next folder dialog answers with `path` (the native dialog cannot be driven by Playwright). */
export async function answerFolderDialog(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [picked],
    })) as typeof dialog.showOpenDialog;
  }, path);
}

/** A typed call through the same preload bridge the UI uses. */
export async function call<M extends DesktopMethod>(
  page: Page,
  method: M,
  input: DesktopInput<M>,
): Promise<DesktopOutput<M>> {
  const answer = await page.evaluate(
    async ([name, value]) =>
      (window as unknown as { crew: { invoke: (m: string, i: unknown) => Promise<unknown> } }).crew.invoke(
        name,
        value,
      ),
    [method, input] as const,
  );
  const typed = answer as { ok: boolean; result?: unknown; error?: string };
  if (!typed.ok) throw new Error(typed.error);
  return typed.result as DesktopOutput<M>;
}

export async function appInfo(page: Page): Promise<AppInfo> {
  return call(page, 'app.info', {});
}

/** Waits until the status view reports every check green (re-running the checks while the stream connects). */
export async function expectAllGreen(page: Page): Promise<void> {
  const health = page.getByRole('region', { name: 'Sức khỏe' });
  await expect(async () => {
    await health.getByRole('button', { name: 'Kiểm tra ngay' }).click();
    await expect(health.getByRole('button', { name: 'Kiểm tra ngay' })).toBeEnabled({ timeout: 60_000 });
    const notGreen = await health
      .locator('[data-check]:not([data-status="green"])')
      .evaluateAll((rows) => rows.map((row) => `${row.getAttribute('data-check')}: ${row.textContent}`));
    expect(notGreen).toEqual([]);
    await expect(health.getByText('Mọi kiểm tra đều ổn.')).toBeVisible();
  }).toPass({ timeout: 120_000, intervals: [1_000, 2_000, 5_000] });
}

/** The owner's web session (username and password), for the owner-only routes the tests need. */
export async function ownerSession(): Promise<{
  request: (method: string, path: string, body?: unknown) => Promise<Response>;
}> {
  const { username, password } = state();
  const origin = E2E_API_URL;
  const login = await fetch(`${E2E_API_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ username, password }),
  });
  if (!login.ok) throw new Error(`owner login failed: ${login.status} ${await login.text()}`);
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const { csrfToken } = (await login.json()) as { csrfToken: string };
  return {
    request: (method, path, body) =>
      fetch(`${E2E_API_URL}${path}`, {
        method,
        headers: {
          cookie,
          origin,
          [CSRF_HEADER]: csrfToken,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
  };
}

/** Screenshots go outside the repo when CREW_E2E_SCREENSHOTS names a folder. */
export async function screenshot(page: Page, name: string): Promise<void> {
  const dir = process.env.CREW_E2E_SCREENSHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}

/**
 * The owner's side of the web, through the owner API: create and assign projects, and ask a machine for a
 * remote action and wait for its result.
 */
export async function ownerWeb() {
  const owner = await ownerSession();
  const json = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await owner.request(method, path, body);
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  };
  return {
    request: owner.request,
    createProject: (body: { key: string; name: string; repoUrl: string; platform: string }) =>
      json<{ id: string; key: string }>('POST', '/v1/projects', {
        description: `Dự án ${body.name}.`,
        ...body,
      }),
    projectId: async (key: string) =>
      (await json<{ items: { id: string; key: string }[] }>('GET', '/v1/projects')).items.find(
        (item) => item.key === key,
      )?.id ?? '',
    assign: (machineId: string, body: { projectId: string } | { hostsAssistant: true }) =>
      json('POST', `/v1/machines/${machineId}/claims`, body),
    machine: async (name: string) =>
      (await json<{ items: Machine[] }>('GET', '/v1/machines')).items.find((item) => item.name === name),
    command: async (machineId: string, body: object): Promise<MachineCommand> => {
      const asked = await json<MachineCommand>('POST', `/v1/machines/${machineId}/commands`, body);
      let command = asked;
      await expect
        .poll(
          async () => {
            command = await json<MachineCommand>('GET', `/v1/machines/${machineId}/commands/${asked.id}`);
            return command.status;
          },
          { timeout: 120_000, intervals: [500] },
        )
        .toMatch(/^(done|failed|expired)$/);
      return command;
    },
  };
}

/** This test machine's id, from its config. */
export function machineIdOf(env: TestEnv): string {
  return readFileSync(join(env.home, 'config.yaml'), 'utf8').match(/machineId: (\S+)/)?.[1] ?? '';
}
