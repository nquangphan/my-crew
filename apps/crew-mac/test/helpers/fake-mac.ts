import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { MacContext } from '../../src/context.js';
import type { Manifest } from '../../src/manifest.js';
import { SPIKE_LABEL } from '../../src/paths.js';
import { BMAD_PLUGIN_JSON } from '../../src/workflows/bmad-pin.js';
import { pinDir, type WorkflowPin } from '../../src/workflows/pin.js';
import { treeChecksum } from '../../src/workflows/tree-checksum.js';
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
  executables: ['dir/b.txt'],
};

/** Cây BMAD đã lắp tối thiểu: hai skill (một từ mỗi cây nguồn) và plugin.json của Crew. */
export function writeBmadTree(dir: string): void {
  mkdirSync(join(dir, 'skills', 'm1'), { recursive: true });
  mkdirSync(join(dir, 'skills', 'bmad', 'scripts'), { recursive: true });
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(dir, 'skills', 'm1', 'SKILL.md'), '---\nname: m1\n---\n');
  writeFileSync(join(dir, 'skills', 'bmad', 'scripts', 'setup.py'), 'print("setup")\n', { mode: 0o755 });
  chmodSync(join(dir, 'skills', 'bmad', 'scripts', 'setup.py'), 0o755);
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), BMAD_PLUGIN_JSON);
}

const FIXTURE_BMAD_CHECKSUM = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'crew-bmad-ref-'));
  writeBmadTree(dir);
  return treeChecksum(dir).checksum;
})();

/** Pin BMAD giả khớp `writeBmadTree`; checksum tính lúc nạp module vì cây chứa `BMAD_PLUGIN_JSON` thật. */
export function fixtureBmadPin(revision: string = 'b'.repeat(40)): WorkflowPin {
  return {
    workflow: 'bmad',
    version: '9.9.9-next',
    revision,
    checksum: FIXTURE_BMAD_CHECKSUM,
    executables: ['skills/bmad/scripts/setup.py'],
  };
}

export const FIXTURE_BMAD_PIN: WorkflowPin = fixtureBmadPin();

export function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync('/usr/bin/git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/**
 * Repo git thật dạng `bmad-plugins` ở `dir` (mặc định marketplace `bmad` dưới HOME): `plugins/method/skills/m1` và
 * `plugins/toolbox/skills/bmad/scripts/setup.py` (0755), cộng một file ngoài hai cây. `duplicate` thêm skill `m1` vào
 * cây toolbox.
 */
export function seedBmadMarketplace(
  home: string,
  options: { dir?: string; duplicate?: boolean } = {},
): { dir: string; revision: string } {
  const dir = options.dir ?? join(home, '.claude', 'plugins', 'marketplaces', 'bmad');
  const method = join(dir, 'plugins', 'method', 'skills', 'm1');
  const scripts = join(dir, 'plugins', 'toolbox', 'skills', 'bmad', 'scripts');
  mkdirSync(method, { recursive: true });
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(dir, 'README.md'), 'bmad-plugins\n');
  writeFileSync(join(method, 'SKILL.md'), '---\nname: m1\n---\n');
  writeFileSync(join(scripts, 'setup.py'), 'print("setup")\n', { mode: 0o755 });
  chmodSync(join(scripts, 'setup.py'), 0o755);
  if (options.duplicate) {
    mkdirSync(join(dir, 'plugins', 'toolbox', 'skills', 'm1'), { recursive: true });
    writeFileSync(join(dir, 'plugins', 'toolbox', 'skills', 'm1', 'SKILL.md'), 'trùng\n');
  }
  gitIn(dir, 'init', '-q');
  gitIn(dir, 'add', '.');
  gitIn(dir, 'commit', '-q', '-m', 'init');
  return { dir, revision: gitIn(dir, 'rev-parse', 'HEAD') };
}

/** Cho `/usr/bin/git` và `/usr/bin/tar` của FakeRunner chạy lệnh thật (vẫn ghi nhận từng lời gọi). */
export function passThroughGitTar(runner: FakeRunner): FakeRunner {
  const real = (command: string) => (args: readonly string[]) => {
    const r = spawnSync(command, [...args], { encoding: 'utf8' });
    return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  return runner.on('/usr/bin/git', real('/usr/bin/git')).on('/usr/bin/tar', real('/usr/bin/tar'));
}

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
  writeFileSync(join(installPath, 'dir', 'b.txt'), 'b\n', { mode: 0o755 });
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
    /** Các label mà `launchctl bootout` báo lỗi và job vẫn nạp. */
    bootoutFails?: string[];
    /** Mặc định true: bản ghim BMAD `FIXTURE_BMAD_PIN` đã có sẵn dưới ~/.crew/workflows (setup không phải tải). */
    bmadInstalled?: boolean;
  } = {},
) {
  const home = mkdtempSync(join(tmpdir(), 'crew-mac-home-'));
  if (options.ownerSuperpowers !== false) seedOwnerPlugin(home);
  if (options.bmadInstalled !== false) writeBmadTree(pinDir(home, FIXTURE_BMAD_PIN));
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
      if (verb === 'bootout') {
        if (options.bootoutFails?.includes(labelOf(target)))
          return { code: 5, stderr: 'Boot-out failed: 5: Input/output error' };
        return loaded.delete(labelOf(target)) ? {} : { code: 3, stderr: 'No such process' };
      }
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
    bmadPin: FIXTURE_BMAD_PIN,
  };
  return { home, ctx, runner, loaded, out };
}

/** Manifest hợp lệ tối thiểu (chế độ LaunchAgent, không có trường `sshdOwner`). */
export const BASE_MANIFEST: Manifest = {
  version: 1,
  port: 2222,
  listenAddress: '100.102.189.67',
  worktreeRoot: '/Users/owner/crew-agents',
  paperclipKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPaperclipTestKey000000000000000000000000',
  installedAt: '2026-10-06T07:00:00.000Z',
};

export const APP_EXECUTABLE = '/Applications/2P Crew.app/Contents/MacOS/2P Crew';

export interface FakeProc {
  ppid: number;
  /** argv đầy đủ (`ps -o command=`). */
  command: string;
  /** `ps -o comm=`: đường dẫn file thực thi; mặc định là token đầu của `command`. */
  comm?: string;
}

/**
 * Thay handler `/bin/ps` bằng bảng process giả: trả lời `ps -o pid=,ppid=,command= -p <pid>`, `ps -o comm= -p <pid>`
 * và ba lệnh quét toàn bảng của `listProcesses`. `table` được gọi lại mỗi lần để test cho process sống/chết theo lượt.
 */
export function fakeProcs(runner: FakeRunner, table: () => Partial<Record<number, FakeProc>>): void {
  runner.on('/bin/ps', (args) => {
    const procs = table();
    const at = args.indexOf('-p');
    if (at >= 0) {
      const pid = Number(args[at + 1]);
      const proc = procs[pid];
      if (!proc) return { code: 1 };
      if (args.includes('comm=')) return { stdout: `${proc.comm ?? proc.command.split(' ')[0]}\n` };
      return { stdout: `${pid} ${proc.ppid} ${proc.command}\n` };
    }
    const rows = Object.entries(procs).filter((row): row is [string, FakeProc] => row[1] !== undefined);
    if (args.some((a) => a.includes('comm=')))
      return {
        stdout: rows
          .map(([pid, p]) => `${pid} ${p.ppid} ${pid} ?? 01:00 ${p.comm ?? p.command.split(' ')[0]}\n`)
          .join(''),
      };
    return { stdout: rows.map(([pid, p]) => `${pid} ${p.command}\n`).join('') };
  });
}
