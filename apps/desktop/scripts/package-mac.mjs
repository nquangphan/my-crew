#!/usr/bin/env node
/**
 * Builds the universal macOS dmg into `apps/desktop/release/`. The app is staged in a temp folder outside
 * the pnpm workspace, so electron-builder collects the staged npm tree (both Claude Code binaries, the
 * per-arch better-sqlite3 rebuilds) instead of resolving the workspace's pnpm store.
 * `--publish` uploads to GitHub Releases (the release job; needs GH_TOKEN).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import builder from 'electron-builder';
import { parse } from 'yaml';

const { Arch, Platform, build } = builder;
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const work = join(tmpdir(), 'crew-desktop-package');
const app = join(work, 'app');

rmSync(work, { recursive: true, force: true });
execFileSync(process.execPath, [join(root, 'scripts', 'stage-app.mjs'), '--universal', '--out', app], {
  stdio: 'inherit',
});
if (!existsSync(join(root, 'build', 'icon.png'))) throw new Error('build/icon.png is missing');

// Detect npm from the staged lockfile, not from the pnpm that launched this script.
delete process.env.npm_config_user_agent;
delete process.env.npm_execpath;

const config = parse(readFileSync(join(root, 'electron-builder.yml'), 'utf8'));
config.directories = { output: join(root, 'release'), buildResources: join(root, 'build') };
config.mac.icon = join(root, 'build', 'icon.png');
// The staged app has no electron dependency to read the version from.
config.electronVersion = JSON.parse(
  readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8'),
).version;

try {
  const artifacts = await build({
    projectDir: app,
    config,
    targets: Platform.MAC.createTarget(['dmg'], Arch.universal),
    publish: process.argv.includes('--publish') ? 'always' : 'never',
  });
  console.log(artifacts.join('\n'));
} finally {
  rmSync(work, { recursive: true, force: true });
}
