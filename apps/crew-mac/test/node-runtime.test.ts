import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderLauncher } from '../src/launcher.js';
import {
  crewNodeBin,
  downloadNode,
  ensureNode,
  type FetchLike,
  isInsideAppBundle,
  NO_NODE_MESSAGE,
  pickLtsVersion,
  resolveNode,
  shasumFor,
  stableNodePath,
} from '../src/node-runtime.js';
import { createRunner } from '../src/system.js';
import { FakeRunner } from './helpers/fake-runner.js';

const NODE_ARGS = '-p process.versions.node';
const SHELL = '/bin/zsh';
const LOGIN = '-ilc command -v node';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Script giả làm `node`: in version cho `-p process.versions.node`. */
function writeFakeNode(path: string, version: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
  return path;
}

/** Runner giả: mỗi đường node trả version cho `-p`, shell đăng nhập in `shellOut`. */
function nodeRunner(versions: Record<string, string>, shellOut?: { stdout: string; code?: number }) {
  const runner = new FakeRunner();
  for (const [path, version] of Object.entries(versions)) {
    runner.on(path, (args) => (args.join(' ') === NODE_ARGS ? { stdout: `${version}\n` } : undefined));
  }
  if (shellOut) runner.on(SHELL, (args) => (args.join(' ') === LOGIN ? shellOut : undefined));
  return runner;
}

describe('resolveNode', () => {
  const home = '/Users/owner';
  const crewNode = crewNodeBin('/Users/owner/.crew');

  it('ưu tiên Homebrew', async () => {
    const runner = nodeRunner({ '/opt/homebrew/bin/node': '24.1.0', [crewNode]: '22.20.0' });
    await expect(resolveNode({ home, runner })).resolves.toEqual({
      path: '/opt/homebrew/bin/node',
      source: 'homebrew',
      version: '24.1.0',
    });
  });

  it('không có Homebrew thì lấy ~/.crew/node trước shell đăng nhập', async () => {
    const runner = nodeRunner(
      { [crewNode]: '22.20.0', '/Users/owner/.nvm/versions/node/v24.1.0/bin/node': '24.1.0' },
      { stdout: '/Users/owner/.nvm/versions/node/v24.1.0/bin/node\n' },
    );
    await expect(resolveNode({ home, runner })).resolves.toMatchObject({ path: crewNode, source: 'crew' });
    expect(runner.calls.some((call) => call.command === SHELL)).toBe(false);
  });

  it('shell đăng nhập (nvm): lấy dòng cuối là đường tuyệt đối, bỏ rác in trước, quá hạn 15 giây', async () => {
    const nvm = '/Users/owner/.nvm/versions/node/v24.1.0/bin/node';
    const runner = nodeRunner(
      { [nvm]: '24.1.0' },
      { stdout: `Chào owner!\nLast login: hôm qua\n${nvm}\n\n` },
    );
    await expect(resolveNode({ home, runner })).resolves.toEqual({
      path: nvm,
      source: 'login-shell',
      version: '24.1.0',
    });
    expect(runner.calls.find((call) => call.command === SHELL)?.options.timeoutMs).toBe(15_000);
  });

  it('shell đăng nhập in dòng cuối không phải đường tuyệt đối thì không nhận', async () => {
    const runner = nodeRunner({}, { stdout: 'node: aliased to nvm-node\n' });
    await expect(resolveNode({ home, runner })).resolves.toBeNull();
  });

  it('loại node major < 22 và loại đường nằm trong .app', async () => {
    const helper =
      '/Applications/2P Crew.app/Contents/Frameworks/2P Crew Helper.app/Contents/MacOS/2P Crew Helper';
    const runner = nodeRunner(
      { '/opt/homebrew/bin/node': '20.18.0', [helper]: '22.20.0' },
      { stdout: `${helper}\n` },
    );
    await expect(resolveNode({ home, runner })).resolves.toBeNull();
    // Đường trong .app không bao giờ được chạy thử.
    expect(runner.calls.some((call) => call.command === helper)).toBe(false);
  });

  it('--skip-system bỏ Homebrew và shell đăng nhập, chỉ xét <prefix>/node', async () => {
    const prefixNode = crewNodeBin('/tmp/thu');
    const runner = nodeRunner(
      { '/opt/homebrew/bin/node': '24.1.0', [prefixNode]: '22.20.0' },
      { stdout: '/x/node' },
    );
    await expect(resolveNode({ home, runner, prefix: '/tmp/thu', skipSystem: true })).resolves.toMatchObject({
      path: prefixNode,
      source: 'crew',
    });
    expect(runner.calls.map((call) => call.command)).toEqual([prefixNode]);
  });
});

describe('isInsideAppBundle', () => {
  it('nhận cả đường trực tiếp lẫn symlink trỏ vào .app', () => {
    const dir = tmp('node-app-');
    const helper = join(dir, '2P Crew.app', 'Contents', 'MacOS', '2P Crew Helper');
    writeFakeNode(helper, '22.0.0');
    const link = join(dir, 'node');
    symlinkSync(helper, link);
    expect(isInsideAppBundle(helper)).toBe(true);
    expect(isInsideAppBundle(link)).toBe(true);
    expect(isInsideAppBundle('/opt/homebrew/bin/node')).toBe(false);
  });
});

describe('pickLtsVersion và shasumFor', () => {
  it('lấy bản đầu tiên có lts và major ≥ 22', () => {
    expect(
      pickLtsVersion([
        { version: 'v25.0.0', lts: false },
        { version: 'v24.11.0', lts: 'Krypton' },
        { version: 'v22.20.0', lts: 'Jod' },
      ]),
    ).toBe('v24.11.0');
    expect(() => pickLtsVersion([{ version: 'v20.1.0', lts: 'Iron' }])).toThrow('không có bản LTS');
    expect(() => pickLtsVersion({})).toThrow('không đúng dạng');
  });

  it('đọc đúng dòng của tệp, thiếu thì ném', () => {
    const sum = 'a'.repeat(64);
    const text = `${'b'.repeat(64)}  node-v24.11.0-darwin-x64.tar.gz\n${sum}  node-v24.11.0-darwin-arm64.tar.gz\n`;
    expect(shasumFor(text, 'node-v24.11.0-darwin-arm64.tar.gz')).toBe(sum);
    expect(() => shasumFor(text, 'node-v24.11.0-linux-x64.tar.gz')).toThrow('không có');
  });
});

const VERSION = 'v24.11.0';
const FILE = `node-${VERSION}-darwin-arm64.tar.gz`;

/** Tarball giống bản chính thức: thư mục gốc `node-<v>-darwin-arm64/` có `bin/node` (script in version). */
function fixtureTarball(): Buffer {
  const dir = tmp('node-fixture-');
  writeFakeNode(join(dir, `node-${VERSION}-darwin-arm64`, 'bin', 'node'), VERSION.slice(1));
  const out = join(dir, FILE);
  const tar = spawnSync('/usr/bin/tar', ['-czf', out, '-C', dir, `node-${VERSION}-darwin-arm64`]);
  expect(tar.status).toBe(0);
  return readFileSync(out);
}

function fakeFetch(tarball: Buffer, sha256: string): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetch: FetchLike = async (url) => {
    urls.push(url);
    const body = (() => {
      if (url === 'https://nodejs.org/dist/index.json')
        return JSON.stringify([
          { version: 'v25.1.0', lts: false },
          { version: VERSION, lts: 'Krypton' },
        ]);
      if (url === `https://nodejs.org/dist/${VERSION}/SHASUMS256.txt`)
        return `${'0'.repeat(64)}  node-${VERSION}-darwin-x64.tar.gz\n${sha256}  ${FILE}\n`;
      if (url === `https://nodejs.org/dist/${VERSION}/${FILE}`) return tarball;
      return null;
    })();
    if (body === null)
      return { ok: false, status: 404, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
    const bytes = typeof body === 'string' ? Buffer.from(body) : body;
    return {
      ok: true,
      status: 200,
      text: async () => bytes.toString('utf8'),
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };
  };
  return { fetch, urls };
}

describe('downloadNode / ensureNode (fetch giả, tar thật)', () => {
  const sha = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

  it('checksum đúng: giải nén vào <prefix>/node, không để lại tệp tạm', async () => {
    const prefix = tmp('node-prefix-');
    const tarball = fixtureTarball();
    const { fetch, urls } = fakeFetch(tarball, sha(tarball));
    const info = await ensureNode({
      home: '/khong/dung',
      runner: createRunner(),
      prefix,
      skipSystem: true,
      fetch,
      arch: 'arm64',
    });
    expect(info).toEqual({
      path: join(prefix, 'node', 'bin', 'node'),
      source: 'downloaded',
      version: '24.11.0',
    });
    expect(urls).toEqual([
      'https://nodejs.org/dist/index.json',
      `https://nodejs.org/dist/${VERSION}/SHASUMS256.txt`,
      `https://nodejs.org/dist/${VERSION}/${FILE}`,
    ]);
    expect(readdirSync(prefix)).toEqual(['node']);
    // Lần sau dò thấy bản đã tải, không tải lại.
    const again = await ensureNode({
      home: '/khong/dung',
      runner: createRunner(),
      prefix,
      skipSystem: true,
      fetch,
    });
    expect(again.source).toBe('crew');
    expect(urls).toHaveLength(3);
  });

  it('checksum sai: báo lỗi, xóa tệp tải, không đụng <prefix>/node cũ', async () => {
    const prefix = tmp('node-prefix-');
    const old = writeFakeNode(join(prefix, 'node', 'bin', 'node'), '20.0.0');
    const tarball = fixtureTarball();
    const { fetch } = fakeFetch(tarball, 'f'.repeat(64));
    await expect(
      downloadNode({ home: '/khong/dung', runner: createRunner(), prefix, fetch, arch: 'arm64' }),
    ).rejects.toThrow('không khớp SHASUMS256');
    expect(readdirSync(prefix)).toEqual(['node']);
    expect(readFileSync(old, 'utf8')).toContain('20.0.0');
  });

  it('đổi chỗ nguyên khối: bản cũ (major < 22) được thay hết, không trộn tệp', async () => {
    const prefix = tmp('node-prefix-');
    writeFakeNode(join(prefix, 'node', 'bin', 'node'), '20.0.0');
    writeFileSync(join(prefix, 'node', 'cu.txt'), 'bản cũ');
    const tarball = fixtureTarball();
    const { fetch } = fakeFetch(tarball, sha(tarball));
    const info = await ensureNode({
      home: '/khong/dung',
      runner: createRunner(),
      prefix,
      skipSystem: true,
      fetch,
      arch: 'arm64',
    });
    expect(info.source).toBe('downloaded');
    expect(existsSync(join(prefix, 'node', 'cu.txt'))).toBe(false);
    expect(readdirSync(prefix)).toEqual(['node']);
  });

  it('HTTP lỗi và kiến trúc lạ báo rõ', async () => {
    const prefix = tmp('node-prefix-');
    const failing: FetchLike = async () => ({
      ok: false,
      status: 503,
      text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    await expect(
      downloadNode({ home: '/x', runner: createRunner(), prefix, fetch: failing, arch: 'arm64' }),
    ).rejects.toThrow('HTTP 503');
    await expect(
      downloadNode({ home: '/x', runner: createRunner(), prefix, fetch: failing, arch: 'ia32' }),
    ).rejects.toThrow('kiến trúc ia32');
  });
});

describe('stableNodePath', () => {
  function homeWithLauncher(nodePath: string | null): string {
    const home = tmp('node-home-');
    if (nodePath !== null) {
      mkdirSync(join(home, '.crew', 'bin'), { recursive: true });
      writeFileSync(join(home, '.crew', 'bin', 'crew-mac'), renderLauncher(nodePath, '/x/cli.js'), {
        mode: 0o755,
      });
    }
    return home;
  }

  it('dưới Electron không bao giờ trả execPath: không có node thì ném', () => {
    const home = homeWithLauncher(null);
    expect(() =>
      stableNodePath({
        home,
        electron: true,
        brewPaths: [],
        execPath: '/Applications/2P Crew.app/Contents/MacOS/2P Crew',
      }),
    ).toThrow(NO_NODE_MESSAGE);
  });

  it('dưới Electron bỏ launcher trỏ vào .app (Helper) rồi ném', () => {
    const dir = tmp('node-app-');
    const helper = writeFakeNode(join(dir, '2P Crew.app', 'Contents', 'MacOS', '2P Crew Helper'), '22.0.0');
    const home = homeWithLauncher(helper);
    expect(() => stableNodePath({ home, electron: true, brewPaths: [] })).toThrow(NO_NODE_MESSAGE);
  });

  it('thứ tự: Homebrew, ~/.crew/node, node trong launcher', () => {
    const nvm = writeFakeNode(join(tmp('nvm-'), 'bin', 'node'), '24.1.0');
    const home = homeWithLauncher(nvm);
    expect(stableNodePath({ home, electron: true, brewPaths: [] })).toBe(nvm);
    const crewNode = writeFakeNode(crewNodeBin(join(home, '.crew')), '24.1.0');
    expect(stableNodePath({ home, electron: true, brewPaths: [] })).toBe(crewNode);
    const brew = writeFakeNode(join(tmp('brew-'), 'node'), '24.1.0');
    expect(stableNodePath({ home, electron: true, brewPaths: ['/khong/co/node', brew] })).toBe(brew);
  });

  it('CLI chạy bằng node thật vẫn rơi về execPath', () => {
    const home = homeWithLauncher(null);
    expect(
      stableNodePath({ home, electron: false, brewPaths: [], execPath: '/usr/local/bin/node-that' }),
    ).toBe('/usr/local/bin/node-that');
  });
});
