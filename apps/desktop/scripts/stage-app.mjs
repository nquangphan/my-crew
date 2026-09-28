#!/usr/bin/env node
/**
 * Stages the desktop app for packaging and for the Electron E2E tests, in `apps/desktop/.stage/app`:
 *   - the electron-vite output (`out/`);
 *   - a package.json whose dependencies are only the runtime externals (better-sqlite3, the Agent SDK, the
 *     MCP SDK, electron-updater), installed with npm into a flat node_modules, so the pnpm store is never
 *     rebuilt for Electron's ABI (that would break the Node test suites);
 *   - the crew-docs bundle as `resources/crew-docs.cjs` (copied to ~/.crew/bin on first run and updates);
 *   - better-sqlite3 rebuilt for this Electron version.
 * `--universal` also installs the x64 and arm64 Claude Code binaries of the Agent SDK, so the universal dmg
 * runs agents on both architectures (electron-builder then rebuilds better-sqlite3 per architecture).
 * `--out <dir>` stages into another folder (see package-mac.mjs). `--if-missing` skips the work when a stage already exists (the E2E entry point).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const args = new Set(argv);
const outIndex = argv.indexOf('--out');
/** `--out <dir>` stages elsewhere (packaging stages outside the pnpm workspace). */
const stage = outIndex >= 0 && argv[outIndex + 1] ? argv[outIndex + 1] : join(root, '.stage', 'app');
const universal = args.has('--universal');
const OUTPUT_DIR = 'out';
const BUNDLE_DIR = ['..', '..', 'packages', 'docs-kit', 'dist'];

function run(command, commandArgs, cwd) {
  execFileSync(command, commandArgs, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, npm_config_update_notifier: 'false' },
  });
}

/** A 1024×1024 app icon (blue rounded square, white "2P" bars) written without an image library. */
function writeIcon(path) {
  const size = 1024;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const inRoundedSquare = (x, y) => {
    const margin = 100;
    const radius = 180;
    const cx = Math.min(Math.max(x, margin + radius), size - margin - radius);
    const cy = Math.min(Math.max(y, margin + radius), size - margin - radius);
    return (
      x >= margin &&
      x < size - margin &&
      y >= margin &&
      y < size - margin &&
      Math.hypot(x - cx, y - cy) <= radius
    );
  };
  const bars = [
    [300, 330, 424, 380],
    [374, 380, 424, 500],
    [300, 500, 424, 550],
    [300, 550, 350, 694],
    [300, 644, 424, 694],
    [540, 330, 590, 694],
    [590, 330, 700, 380],
    [650, 380, 700, 500],
    [590, 500, 700, 550],
  ];
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const offset = row + 1 + x * 4;
      if (!inRoundedSquare(x, y)) continue;
      const white = bars.some(([x1, y1, x2, y2]) => x >= x1 && x < x2 && y >= y1 && y < y2);
      raw.set(white ? [255, 255, 255, 255] : [0x1d, 0x5f, 0xd1, 255], offset);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

if (args.has('--if-missing') && existsSync(join(stage, 'node_modules', 'better-sqlite3'))) {
  console.log(`stage exists: ${stage}`);
  process.exit(0);
}

const built = join(root, OUTPUT_DIR, 'main', 'index.js');
if (!existsSync(built)) throw new Error(`build the app first (electron-vite build): ${built} is missing`);
const bundle = join(root, ...BUNDLE_DIR, 'crew-docs.cjs');
if (!existsSync(bundle))
  throw new Error(`build crew-docs first (pnpm --filter @crew/docs-kit build): ${bundle} is missing`);

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(
  readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8'),
).version;

const SDK = '@anthropic-ai/claude-agent-sdk';
const sdkVersion = pkg.dependencies[SDK];

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'resources'), { recursive: true });
cpSync(join(root, OUTPUT_DIR), join(stage, OUTPUT_DIR), { recursive: true });
cpSync(bundle, join(stage, 'resources', 'crew-docs.cjs'));
writeFileSync(
  join(stage, 'package.json'),
  `${JSON.stringify(
    {
      name: 'crew-desktop',
      productName: pkg.productName,
      version: pkg.version,
      description: pkg.description,
      author: pkg.author,
      type: 'module',
      main: `./${OUTPUT_DIR}/main/index.js`,
      dependencies: pkg.dependencies,
      // Both macOS Claude Code binaries of the pinned SDK, so the universal app runs agents on both.
      ...(universal
        ? { optionalDependencies: { [`${SDK}-darwin-arm64`]: sdkVersion, [`${SDK}-darwin-x64`]: sdkVersion } }
        : {}),
    },
    null,
    2,
  )}\n`,
);

// A lockfile makes electron-builder collect this npm tree (not the pnpm workspace). `--force` installs the
// other architecture's optional SDK binary too.
run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', ...(universal ? ['--force'] : [])], stage);
if (universal) {
  // npm skips the optional binary of the other architecture even with --force: unpack it from its tarball.
  for (const cpu of ['arm64', 'x64']) {
    const target = join(stage, 'node_modules', '@anthropic-ai', `claude-agent-sdk-darwin-${cpu}`);
    if (existsSync(join(target, 'claude'))) continue;
    const packed = join(stage, '.packed');
    mkdirSync(packed, { recursive: true });
    const tarball = execFileSync(
      'npm',
      ['pack', `${SDK}-darwin-${cpu}@${sdkVersion}`, '--silent', '--pack-destination', packed],
      {
        cwd: stage,
        encoding: 'utf8',
      },
    ).trim();
    mkdirSync(target, { recursive: true });
    run(
      'tar',
      ['-xzf', join(packed, tarball.split('\n').at(-1) ?? ''), '-C', target, '--strip-components=1'],
      stage,
    );
    rmSync(packed, { recursive: true, force: true });
  }
  if (!existsSync(join(root, 'build', 'icon.png'))) writeIcon(join(root, 'build', 'icon.png'));
} else {
  run(
    join(root, 'node_modules', '.bin', 'electron-rebuild'),
    ['--version', electronVersion, '--module-dir', stage, '--only', 'better-sqlite3', '--force'],
    root,
  );
}
console.log(`staged ${pkg.productName} ${pkg.version} for Electron ${electronVersion} at ${stage}`);
