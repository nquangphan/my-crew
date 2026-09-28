#!/usr/bin/env node
/**
 * Builds one macOS dmg per architecture into `apps/desktop/release/`: `2P-Crew-<version>-arm64.dmg` and
 * `2P-Crew-<version>-x64.dmg`. The app is staged in a temp folder outside the pnpm workspace, so
 * electron-builder collects the staged npm tree (both Claude Code binaries, better-sqlite3) instead of
 * resolving the workspace's pnpm store. One electron-builder run packs both architectures from that stage,
 * so `latest-mac.yml` lists both dmgs; after each pack, before signing, the other architecture's Claude
 * Code binary and the other better-sqlite3 prebuilds are removed, so each app carries only its own.
 * `--publish` uploads to GitHub Releases (the release job; needs GH_TOKEN).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import builder from 'electron-builder';
import { parse } from 'yaml';

const { Arch, Platform, build } = builder;
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const work = join(tmpdir(), 'crew-desktop-package');
const app = join(work, 'app');
const ARCHS = ['arm64', 'x64'];
const SDK_BINARY_PREFIX = 'claude-agent-sdk-darwin-';

rmSync(work, { recursive: true, force: true });
execFileSync(process.execPath, [join(root, 'scripts', 'stage-app.mjs'), '--both-archs', '--out', app], {
  stdio: 'inherit',
});
if (!existsSync(join(root, 'build', 'icon.png'))) throw new Error('build/icon.png is missing');

// Detect npm from the staged lockfile, not from the pnpm that launched this script.
delete process.env.npm_config_user_agent;
delete process.env.npm_execpath;

/**
 * Drops the other architecture's Claude Code binary from a packed app, and every better-sqlite3 prebuild
 * except this app's `darwin-<arch>` one (the one it loads).
 */
function keepOnlyArch(context) {
  const arch = Arch[context.arch];
  if (!ARCHS.includes(arch)) throw new Error(`unexpected architecture ${arch}`);
  const modules = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Resources',
    'app',
    'node_modules',
  );
  const own = join(modules, '@anthropic-ai', `${SDK_BINARY_PREFIX}${arch}`, 'claude');
  if (!existsSync(own)) throw new Error(`the ${arch} app has no Claude Code binary at ${own}`);
  for (const other of ARCHS.filter((item) => item !== arch)) {
    rmSync(join(modules, '@anthropic-ai', `${SDK_BINARY_PREFIX}${other}`), { recursive: true, force: true });
  }
  const prebuilds = join(modules, 'better-sqlite3', 'prebuilds');
  if (!existsSync(join(prebuilds, `darwin-${arch}.node`))) {
    throw new Error(`the ${arch} app has no better-sqlite3 darwin-${arch} prebuild`);
  }
  for (const name of readdirSync(prebuilds)) {
    if (!name.startsWith(`darwin-${arch}`)) rmSync(join(prebuilds, name), { recursive: true, force: true });
  }
}

const config = parse(readFileSync(join(root, 'electron-builder.yml'), 'utf8'));
config.directories = { output: join(root, 'release'), buildResources: join(root, 'build') };
config.mac.icon = join(root, 'build', 'icon.png');
config.afterPack = keepOnlyArch;
// The staged app has no electron dependency to read the version from.
config.electronVersion = JSON.parse(
  readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8'),
).version;

try {
  const artifacts = await build({
    projectDir: app,
    config,
    targets: Platform.MAC.createTarget(['dmg'], ...ARCHS.map((arch) => Arch[arch])),
    publish: process.argv.includes('--publish') ? 'always' : 'never',
  });
  console.log(artifacts.join('\n'));
} finally {
  rmSync(work, { recursive: true, force: true });
}
