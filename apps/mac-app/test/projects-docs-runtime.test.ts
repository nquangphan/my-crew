import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpsBridge } from '../src/main/ops-bridge.js';
import {
  type DocsRepairReport,
  installDocsBundle,
  installedDocsBundle,
  repairDocsConfig,
  repairDocsOnStart,
  runtimeProblem,
} from '../src/main/projects/docs-runtime.js';
import { configureDocsBundle, inspectFolder, runGit } from '../src/main/projects/folder.js';
import { makeSandbox } from './projects-fixture.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function sandbox() {
  const s = makeSandbox();
  cleanups.push(s.cleanup);
  const config = (repo: string, key: string) => {
    try {
      return s.git(['-C', repo, 'config', '--get', key]);
    } catch {
      return '';
    }
  };
  return { ...s, config };
}

/** Binary giả trong một bundle `.app`, có quyền chạy như binary thật của app 2P Crew. */
function fakeAppBinary(root: string): string {
  const dir = join(root, 'Applications', '2P Crew.app', 'Contents', 'MacOS');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, '2P Crew');
  writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return file;
}

describe('runtimeProblem', () => {
  it('chỉ nhận file thực thi ngoài .app và khác binary Electron', () => {
    const s = sandbox();
    const plain = join(s.root, 'khong-chay');
    writeFileSync(plain, 'x', { mode: 0o644 });
    expect(runtimeProblem('')).toBe('chưa đặt');
    expect(runtimeProblem(join(s.root, 'khong-co'))).toBe('không phải file');
    expect(runtimeProblem(fakeAppBinary(s.root))).toContain('binary của app');
    expect(runtimeProblem(process.execPath, process.execPath)).toContain('binary của app');
    expect(runtimeProblem(plain)).toBe('không có quyền chạy');
    expect(runtimeProblem(process.execPath)).toBeNull();
  });
});

describe('installDocsBundle', () => {
  it('chép khi chưa có hoặc khác, giống hệt thì không ghi lại', () => {
    const s = sandbox();
    const src = join(s.root, 'crew-docs.cjs');
    writeFileSync(src, '// bản mang theo 1\n');
    const dest = installedDocsBundle(s.home);
    expect(installDocsBundle(src, s.home)).toEqual({ path: dest, installed: true });
    expect(readFileSync(dest, 'utf8')).toBe('// bản mang theo 1\n');
    expect(statSync(dest).mode & 0o777).toBe(0o644);
    const mtime = statSync(dest).mtimeMs;
    expect(installDocsBundle(src, s.home)).toEqual({ path: dest, installed: false });
    expect(statSync(dest).mtimeMs).toBe(mtime);
    writeFileSync(src, '// bản mang theo 2\n');
    expect(installDocsBundle(src, s.home).installed).toBe(true);
    expect(readFileSync(dest, 'utf8')).toBe('// bản mang theo 2\n');
  });

  it('không có bản mang theo thì ném, không đụng bản đã cài', () => {
    const s = sandbox();
    expect(() => installDocsBundle(join(s.root, 'khong-co.cjs'), s.home)).toThrow(
      'Không có bundle crew-docs',
    );
    expect(readFileSync(installedDocsBundle(s.home), 'utf8')).toBe('// bundle giả\n');
  });
});

describe('configureDocsBundle', () => {
  async function run(
    s: ReturnType<typeof sandbox>,
    opts: { nodePath?: () => Promise<string | null>; others?: string[] } = {},
  ) {
    const deps = { home: s.home, env: s.env };
    const info = await inspectFolder(s.folder, deps);
    const nodePath = vi.fn(opts.nodePath ?? (async () => process.execPath));
    await configureDocsBundle(info, { ...deps, statusRepoPaths: async () => opts.others ?? [], nodePath });
    return { info, nodePath };
  }

  it('runtime trỏ vào binary app thì đặt lại sang node thật', async () => {
    const s = sandbox();
    s.git(['-C', s.folder, 'config', 'crew-docs.runtime', fakeAppBinary(s.root)]);
    const { info } = await run(s);
    expect(s.config(info.root, 'crew-docs.runtime')).toBe(process.execPath);
    expect(s.config(info.root, 'crew-docs.bundle')).toBe(installedDocsBundle(s.home));
  });

  it('bundle và runtime owner đặt còn dùng được thì giữ, không dò node', async () => {
    const s = sandbox();
    const own = join(s.root, 'own-node');
    writeFileSync(own, '#!/bin/sh\n', { mode: 0o755 });
    const bundle = join(s.root, 'own.cjs');
    writeFileSync(bundle, '//\n');
    s.git(['-C', s.folder, 'config', 'crew-docs.runtime', own]);
    s.git(['-C', s.folder, 'config', 'crew-docs.bundle', bundle]);
    const { info, nodePath } = await run(s);
    expect(s.config(info.root, 'crew-docs.runtime')).toBe(own);
    expect(s.config(info.root, 'crew-docs.bundle')).toBe(bundle);
    expect(nodePath).not.toHaveBeenCalled();
  });

  it('không chép runtime hỏng của repo khác; runtime dùng được của repo khác thì dùng', async () => {
    const s = sandbox();
    const other = join(s.root, 'other');
    s.git(['init', '-q', other]);
    s.git(['-C', other, 'config', 'crew-docs.runtime', fakeAppBinary(s.root)]);
    const first = await run(s, { others: [other] });
    expect(s.config(first.info.root, 'crew-docs.runtime')).toBe(process.execPath);
    expect(first.nodePath).toHaveBeenCalledTimes(1);

    const good = join(s.root, 'good-node');
    writeFileSync(good, '#!/bin/sh\n', { mode: 0o755 });
    s.git(['-C', other, 'config', 'crew-docs.runtime', good]);
    s.git(['-C', s.folder, 'config', '--unset', 'crew-docs.runtime']);
    const second = await run(s, { others: [other] });
    expect(s.config(second.info.root, 'crew-docs.runtime')).toBe(good);
    expect(second.nodePath).not.toHaveBeenCalled();
  });

  it('không có node thì đặt bundle rồi ném lỗi tiếng Việt, runtime giữ như cũ', async () => {
    const s = sandbox();
    const app = fakeAppBinary(s.root);
    s.git(['-C', s.folder, 'config', 'crew-docs.runtime', app]);
    await expect(run(s, { nodePath: async () => null })).rejects.toThrow(
      'Chưa có node dùng được cho crew-docs.runtime',
    );
    expect(s.config(s.folder, 'crew-docs.runtime')).toBe(app);
    expect(s.config(s.folder, 'crew-docs.bundle')).toBe(installedDocsBundle(s.home));
  });
});

/**
 * Bundle giả làm như `crew-docs install-hooks`: đặt runtime/bundle, nối dòng `# crew-docs:<hook>` vào `.husky/`,
 * vào `core.hooksPath` riêng, hoặc vào `.githooks/` (đặt hooksPath tương đối `.githooks` như bản thật). Mỗi lần chạy
 * ghi một dòng vào `log`. `fail` thì in lỗi ra stderr và thoát mã 3.
 */
function fakeInstallBundle(path: string, log: string, opts: { fail?: boolean } = {}): string {
  writeFileSync(
    path,
    `const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const p = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, args.join(' ') + '\\n');
if (args[0] !== 'install-hooks') process.exit(0);
if (${opts.fail ? 'true' : 'false'}) { console.error('install-hooks: lỗi giả'); process.exit(3); }
const git = (...a) => { try { return execFileSync('/usr/bin/git', a, { encoding: 'utf8' }).trim(); } catch { return ''; } };
const opt = (n) => args[args.indexOf(n) + 1];
const root = git('rev-parse', '--show-toplevel');
git('config', 'crew-docs.runtime', opt('--runtime'));
git('config', 'crew-docs.bundle', opt('--bundle'));
const hp = git('config', '--local', '--get', 'core.hooksPath');
let dir;
if (fs.existsSync(p.join(root, '.husky'))) dir = p.join(root, '.husky');
else if (hp && p.resolve(root, hp) !== p.join(root, '.githooks')) dir = p.resolve(root, hp);
else { if (hp !== '.githooks') git('config', 'core.hooksPath', '.githooks'); dir = p.join(root, '.githooks'); }
fs.mkdirSync(dir, { recursive: true });
for (const h of ['pre-commit', 'commit-msg', 'pre-push']) {
  const f = p.join(dir, h);
  const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '#!/bin/sh\\n';
  if (!cur.includes('# crew-docs:' + h)) fs.writeFileSync(f, cur + 'crew-docs check || exit 1 # crew-docs:' + h + '\\n', { mode: 0o755 });
}
`,
  );
  return path;
}

/** Bundle crew-docs thật (`pnpm --filter @crew/docs-kit build`); chưa build thì bỏ qua ca dùng bản thật. */
const REAL_BUNDLE = fileURLToPath(new URL('../../../packages/docs-kit/dist/crew-docs.cjs', import.meta.url));

describe('configureDocsBundle cài hook crew-docs', () => {
  function setup(opts: { fail?: boolean; bundle?: string } = {}) {
    const s = sandbox();
    const log = join(s.root, 'install-hooks.log');
    const bundle = opts.bundle ?? fakeInstallBundle(installedDocsBundle(s.home), log, opts);
    const configure = async () => {
      const info = await inspectFolder(s.folder, { home: s.home, env: s.env });
      await configureDocsBundle(info, {
        home: s.home,
        env: s.env,
        statusRepoPaths: async () => [],
        nodePath: async () => process.execPath,
      });
      return info;
    };
    const runs = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
    const hooksPath = () => s.config(s.folder, 'core.hooksPath');
    return { s, bundle, configure, runs, hooksPath };
  }

  it('repo chưa có docs/flows.yaml vẫn được đặt bundle, runtime và hook', async () => {
    const { s, bundle, configure, runs, hooksPath } = setup();
    s.git(['-C', s.folder, 'rm', '-q', 'docs/flows.yaml']);
    s.git(['-C', s.folder, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'bỏ flows']);
    s.git(['-C', s.folder, 'push', '-q', 'origin', 'HEAD:main']);
    const info = await configure();
    expect(s.config(info.root, 'crew-docs.bundle')).toBe(bundle);
    expect(s.config(info.root, 'crew-docs.runtime')).toBe(process.execPath);
    expect(runs()).toEqual([`install-hooks --runtime ${process.execPath} --bundle ${bundle}`]);
    expect(hooksPath()).toBe(join(info.root, '.githooks'));
    expect(readFileSync(join(info.root, '.githooks', 'pre-commit'), 'utf8')).toContain(
      '# crew-docs:pre-commit',
    );
  });

  it('hooksPath tương đối .githooks thành đường dẫn tuyệt đối; chạy lại không ghi gì thêm', async () => {
    const { s, configure, runs, hooksPath } = setup();
    const info = await configure();
    expect(hooksPath()).toBe(join(info.root, '.githooks'));
    const configFile = join(info.commonDir, 'config');
    const before = { config: readFileSync(configFile, 'utf8'), mtime: statSync(configFile).mtimeMs };
    const hookMtime = statSync(join(info.root, '.githooks', 'pre-push')).mtimeMs;

    await configure();
    expect(runs()).toHaveLength(1);
    expect(readFileSync(configFile, 'utf8')).toBe(before.config);
    expect(statSync(configFile).mtimeMs).toBe(before.mtime);
    expect(statSync(join(info.root, '.githooks', 'pre-push')).mtimeMs).toBe(hookMtime);
    // Worktree agent thấy cùng bundle và cùng thư mục hook của checkout gốc.
    const wt = join(s.root, 'wt');
    s.git(['-C', info.root, 'worktree', 'add', '-q', '-b', 'agent', wt]);
    expect(s.git(['-C', wt, 'rev-parse', '--path-format=absolute', '--git-path', 'hooks'])).toBe(
      join(info.root, '.githooks'),
    );
    expect(s.config(wt, 'crew-docs.bundle')).toBe(installedDocsBundle(s.home));
  });

  it('husky: hook nối vào .husky, hooksPath giữ như install-hooks để lại; chạy lại không cài lại', async () => {
    const { s, configure, runs, hooksPath } = setup();
    mkdirSync(join(s.folder, '.husky', '_'), { recursive: true });
    const husky = join(realpathSync(s.folder), '.husky', '_');
    s.git(['-C', s.folder, 'config', 'core.hooksPath', husky]);
    const info = await configure();
    expect(hooksPath()).toBe(husky);
    expect(readFileSync(join(info.root, '.husky', 'commit-msg'), 'utf8')).toContain('# crew-docs:commit-msg');
    expect(existsSync(join(info.root, '.githooks'))).toBe(false);
    await configure();
    expect(runs()).toHaveLength(1);
  });

  it('core.hooksPath riêng của repo: hook nối vào đó, không đổi hooksPath', async () => {
    const { s, configure, hooksPath } = setup();
    s.git(['-C', s.folder, 'config', 'core.hooksPath', 'tools/hooks']);
    const info = await configure();
    expect(hooksPath()).toBe('tools/hooks');
    expect(readFileSync(join(info.root, 'tools', 'hooks', 'pre-commit'), 'utf8')).toContain(
      '# crew-docs:pre-commit',
    );
    expect(existsSync(join(info.root, '.githooks'))).toBe(false);
  });

  it('install-hooks lỗi thì ném câu tiếng Việt kèm mã và lý do', async () => {
    const { configure } = setup({ fail: true });
    await expect(configure()).rejects.toThrow(
      /crew-docs install-hooks trong .+ thất bại \(mã 3\): install-hooks: lỗi giả/,
    );
  });

  it.skipIf(!existsSync(REAL_BUNDLE))(
    'bundle thật: .githooks tuyệt đối, chạy lại không đổi git config',
    async () => {
      const { s, configure, hooksPath } = setup({ bundle: REAL_BUNDLE });
      s.git(['-C', s.folder, 'config', 'crew-docs.bundle', REAL_BUNDLE]);
      const info = await configure();
      expect(hooksPath()).toBe(join(info.root, '.githooks'));
      for (const hook of ['pre-commit', 'commit-msg', 'pre-push']) {
        expect(readFileSync(join(info.root, '.githooks', hook), 'utf8')).toContain(`# crew-docs:${hook}`);
      }
      const configFile = join(info.commonDir, 'config');
      const before = readFileSync(configFile, 'utf8');
      await configure();
      expect(readFileSync(configFile, 'utf8')).toBe(before);
      expect(hooksPath()).toBe(join(info.root, '.githooks'));
    },
  );

  it.skipIf(!existsSync(REAL_BUNDLE))(
    'bundle thật + husky: install-hooks tự đổi hooksPath sang tuyệt đối',
    async () => {
      const { s, configure, hooksPath } = setup({ bundle: REAL_BUNDLE });
      s.git(['-C', s.folder, 'config', 'crew-docs.bundle', REAL_BUNDLE]);
      mkdirSync(join(s.folder, '.husky', '_'), { recursive: true });
      s.git(['-C', s.folder, 'config', 'core.hooksPath', '.husky/_']);
      const info = await configure();
      expect(hooksPath()).toBe(join(info.root, '.husky', '_'));
      expect(readFileSync(join(info.root, '.husky', 'pre-commit'), 'utf8')).toContain(
        '# crew-docs:pre-commit',
      );
    },
  );
});

describe('repairDocsConfig', () => {
  it('sửa runtime trong .app và bundle mất; giữ repo lành; bỏ qua repo không dùng crew-docs', async () => {
    const s = sandbox();
    const broken = s.folder;
    s.git(['-C', broken, 'config', 'crew-docs.runtime', fakeAppBinary(s.root)]);
    s.git(['-C', broken, 'config', 'crew-docs.bundle', join(s.root, 'mat.cjs')]);
    const healthy = join(s.root, 'healthy');
    s.git(['init', '-q', healthy]);
    s.git(['-C', healthy, 'config', 'crew-docs.runtime', process.execPath]);
    s.git(['-C', healthy, 'config', 'crew-docs.bundle', installedDocsBundle(s.home)]);
    const plain = join(s.root, 'plain');
    s.git(['init', '-q', plain]);
    const nodePath = vi.fn(async () => process.execPath);

    const result = await repairDocsConfig([broken, healthy, plain], {
      env: s.env,
      git: runGit,
      bundle: installedDocsBundle(s.home),
      nodePath,
    });

    expect(result).toEqual([{ repo: broken, fixed: ['crew-docs.bundle', 'crew-docs.runtime'] }]);
    expect(s.config(broken, 'crew-docs.runtime')).toBe(process.execPath);
    expect(s.config(broken, 'crew-docs.bundle')).toBe(installedDocsBundle(s.home));
    expect(s.config(plain, 'crew-docs.runtime')).toBe('');
    expect(nodePath).toHaveBeenCalledTimes(1);
  });

  it('runtime thiếu mà không có node thì ghi lý do, không đổi gì; repo không đọc được thì bỏ qua', async () => {
    const s = sandbox();
    s.git(['-C', s.folder, 'config', 'crew-docs.bundle', installedDocsBundle(s.home)]);
    const gone = join(s.root, 'khong-con');
    const result = await repairDocsConfig([s.folder, gone], {
      env: s.env,
      git: runGit,
      bundle: installedDocsBundle(s.home),
      nodePath: async () => null,
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ repo: s.folder, fixed: [], skipped: expect.stringContaining('node') });
    expect(result[1]).toMatchObject({ repo: gone, fixed: [], skipped: expect.stringContaining('mã') });
    expect(s.config(s.folder, 'crew-docs.runtime')).toBe('');
  });
});

describe('repairDocsOnStart', () => {
  const opsReturning = (impl: () => Promise<DocsRepairReport>) => {
    const call = vi.fn(impl);
    return { ops: { call } as unknown as Pick<OpsBridge, 'call'>, call };
  };

  it('gọi utility với bundle trong Resources và ghi từng sửa chữa vào log', async () => {
    const { ops, call } = opsReturning(async () => ({
      bundle: { path: '/h/.crew/bin/crew-docs.cjs', installed: true },
      node: '/opt/homebrew/bin/node',
      repos: [
        { repo: '/r/a', fixed: ['crew-docs.runtime'] },
        { repo: '/r/b', fixed: [], skipped: 'git lỗi' },
      ],
    }));
    const log = vi.fn();
    await repairDocsOnStart({ ops, resourcesPath: '/App/Contents/Resources', log });
    expect(call).toHaveBeenCalledWith('repairDocsHooks', '/App/Contents/Resources/crew-docs.cjs');
    expect(log.mock.calls).toEqual([
      ['info', 'docs-bundle-installed', { path: '/h/.crew/bin/crew-docs.cjs' }],
      [
        'info',
        'docs-hooks-repaired',
        { repo: '/r/a', fixed: ['crew-docs.runtime'], runtime: '/opt/homebrew/bin/node' },
      ],
      ['warn', 'docs-hooks-repair-skipped', { repo: '/r/b', reason: 'git lỗi' }],
    ]);
  });

  it('lỗi cài bundle, thiếu node hay utility chết chỉ ghi warn, không ném', async () => {
    const log = vi.fn();
    await repairDocsOnStart({
      ...opsReturning(async () => ({
        bundle: { error: 'Không có bundle' },
        node: null,
        nodeError: 'Chưa có node dùng được',
        repos: [],
      })),
      resourcesPath: '/R',
      log,
    });
    await repairDocsOnStart({
      ...opsReturning(async () => {
        throw new Error('Tiến trình phụ dừng bất thường');
      }),
      resourcesPath: '/R',
      log,
    });
    expect(log.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ['warn', 'docs-bundle-install-failed'],
      ['warn', 'docs-node-missing'],
      ['warn', 'docs-repair-failed'],
    ]);
  });
});
