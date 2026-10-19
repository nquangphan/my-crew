import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

  it('không có node thì để runtime như cũ, vẫn đặt bundle và không ném', async () => {
    const s = sandbox();
    const app = fakeAppBinary(s.root);
    s.git(['-C', s.folder, 'config', 'crew-docs.runtime', app]);
    const { info } = await run(s, { nodePath: async () => null });
    expect(s.config(info.root, 'crew-docs.runtime')).toBe(app);
    expect(s.config(info.root, 'crew-docs.bundle')).toBe(installedDocsBundle(s.home));
  });
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
