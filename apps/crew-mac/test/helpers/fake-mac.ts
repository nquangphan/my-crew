import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { MacContext } from '../../src/context.js';
import { SPIKE_LABEL } from '../../src/paths.js';
import type { WorkflowPin } from '../../src/workflows/pin.js';
import { FakeRunner } from './fake-runner.js';

export const PAPERCLIP_PUB =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPaperclipTestKey000000000000000000000000 paperclip@vps';

export const LIVE_RUN_ID = '0b7f3c2e-7d1a-4c55-9a51-5d0e7a6b9c10';

/** Bảng process có một run Paperclip đang chạy (`claude --print` mang PAPERCLIP_RUN_ID trong env). */
export const LIVE_PS = {
  tree: '  4242     1  4242 ??       00:42 claude\n',
  argv: '  4242 /Users/a/.local/bin/claude --print --output-format stream-json\n',
  env: `  4242 /Users/a/.local/bin/claude --print --output-format stream-json PAPERCLIP_RUN_ID=${LIVE_RUN_ID} HOME=/Users/a\n`,
};

/** Pin giả khớp cây `seedOwnerPlugin` (a.txt, dir/b.txt): test không dựng được cây đúng checksum của bản thật. */
export const FIXTURE_PIN: WorkflowPin = {
  workflow: 'superpowers',
  version: '9.9.9',
  revision: 'f'.repeat(40),
  checksum: '887ad97e9e3f192940fb5320cd393c82f31fa65da974ee62ff923e37fe75b6e5',
};

export function installedPluginsFile(home: string): string {
  return join(home, '.claude', 'plugins', 'installed_plugins.json');
}

/** Giả lập owner đã cài Superpowers qua /plugin: cây plugin trong cache và một entry của installed_plugins.json. */
export function seedOwnerPlugin(
  home: string,
  version: string = FIXTURE_PIN.version,
  sha: string = FIXTURE_PIN.revision,
): string {
  const installPath = join(
    home,
    '.claude',
    'plugins',
    'cache',
    'claude-plugins-official',
    'superpowers',
    version,
  );
  mkdirSync(join(installPath, 'dir'), { recursive: true });
  mkdirSync(join(installPath, '.in_use'), { recursive: true });
  writeFileSync(join(installPath, 'a.txt'), 'a\n');
  writeFileSync(join(installPath, 'dir', 'b.txt'), 'b\n');
  writeFileSync(join(installPath, '.in_use', 'lock'), 'x\n');
  writeFileSync(
    installedPluginsFile(home),
    JSON.stringify({
      version: 2,
      plugins: {
        'superpowers@claude-plugins-official': [
          { scope: 'project', installPath, version, gitCommitSha: sha },
        ],
      },
    }),
  );
  return installPath;
}

export function fakeMac(
  options: {
    tailscaleIp?: string | null;
    gui?: boolean;
    spikeLoaded?: boolean;
    nodePath?: string;
    cliPath?: string;
    ps?: { tree: string; argv: string; env: string };
    /** Mặc định true: owner đã cài Superpowers đúng `FIXTURE_PIN`. */
    ownerSuperpowers?: boolean;
  } = {},
) {
  const home = mkdtempSync(join(tmpdir(), 'crew-mac-home-'));
  if (options.ownerSuperpowers !== false) seedOwnerPlugin(home);
  const loaded = new Set<string>(options.spikeLoaded ? [SPIKE_LABEL] : []);
  const labelOf = (target: string | undefined) => String(target).split('/').at(-1) as string;
  const tailscale = () =>
    options.tailscaleIp === null
      ? { code: 1, stderr: 'Tailscale is stopped.' }
      : { stdout: `${options.tailscaleIp ?? '100.102.189.67'}\n` };
  const runner = new FakeRunner()
    .on('launchctl', (args) => {
      const [verb, target] = args;
      if (verb === 'print' && target === 'gui/501') {
        return options.gui === false ? { code: 113 } : { stdout: 'gui/501 = {\n}\n' };
      }
      if (verb === 'print') {
        return loaded.has(labelOf(target))
          ? { stdout: `${target} = {\n\tstate = running\n\tpid = 4242\n\tlast exit code = 0\n}\n` }
          : { code: 113, stderr: 'Could not find service' };
      }
      if (verb === 'bootstrap') {
        loaded.add(basename(String(args[2]), '.plist'));
        return {};
      }
      if (verb === 'bootout')
        return loaded.delete(labelOf(target)) ? {} : { code: 3, stderr: 'No such process' };
      return { code: 1 };
    })
    .on('/bin/ps', (args) => {
      const ps = options.ps ?? { tree: '', argv: '', env: '' };
      if (args.includes('-E')) return { stdout: ps.env };
      if (args.some((a) => a.includes('comm='))) return { stdout: ps.tree };
      return { stdout: ps.argv };
    })
    .on('tailscale', tailscale)
    .on('/Applications/Tailscale.app/Contents/MacOS/Tailscale', tailscale)
    .on('ssh-keygen', (args) => {
      const file = args[args.indexOf('-f') + 1] as string;
      const comment = args[args.indexOf('-C') + 1] as string;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, 'fake-key-material\n', { mode: 0o600 });
      writeFileSync(
        `${file}.pub`,
        `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFake${comment.replaceAll('-', '')} ${comment}\n`,
      );
      return {};
    });
  const out: string[] = [];
  const ctx: MacContext = {
    home,
    user: 'owner',
    uid: 501,
    platform: 'darwin',
    runner,
    now: () => new Date('2026-10-06T07:00:00.000Z'),
    out: (line) => out.push(line),
    nodePath: options.nodePath ?? '/opt/homebrew/bin/node',
    cliPath: options.cliPath ?? '/opt/crew/apps/crew-mac/dist/cli.js',
    superpowersPin: FIXTURE_PIN,
  };
  return { home, ctx, runner, loaded, out };
}
