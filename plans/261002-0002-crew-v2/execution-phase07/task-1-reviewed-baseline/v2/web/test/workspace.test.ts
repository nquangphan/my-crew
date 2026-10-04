import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const packagePath = join(webRoot, 'package.json');
const sourceRoot = join(webRoot, 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

test('web v2 có package độc lập, base riêng và không nhập source v1', async () => {
  assert.ok(existsSync(packagePath), 'Thiếu v2/web/package.json: chưa tạo workspace web độc lập');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as Record<string, unknown>;
  assert.equal(pkg.name, '@crew-v2/web');
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.packageManager, 'pnpm@10.32.1');

  const scripts = pkg.scripts as Record<string, unknown>;
  assert.deepEqual(scripts, {
    dev: 'vite --host 127.0.0.1',
    build: 'tsc --noEmit && vite build',
    typecheck: 'tsc --noEmit',
    test: 'node --test test/*.test.ts',
    'test:e2e': 'playwright test',
  });

  for (const section of ['dependencies', 'devDependencies'] as const) {
    const dependencies = (pkg[section] ?? {}) as Record<string, string>;
    for (const [name, version] of Object.entries(dependencies)) {
      assert.doesNotMatch(name, /^@crew(?:\/|-v1\/)/, `${section}: ${name} là package v1`);
      assert.doesNotMatch(version, /^(?:workspace:|file:|link:)/, `${section}: ${name} không độc lập`);
    }
  }

  assert.ok(existsSync(join(webRoot, 'pnpm-lock.yaml')), 'Thiếu lockfile riêng v2/web/pnpm-lock.yaml');
  const configModule = await import('../vite.config.ts');
  const configExport = configModule.default;
  const priorApiOrigin = process.env.CREW_V2_WEB_API_ORIGIN;
  process.env.CREW_V2_WEB_API_ORIGIN = 'http://127.0.0.1:49161';
  try {
    const config =
      typeof configExport === 'function'
        ? await configExport({ command: 'serve', mode: 'test', isSsrBuild: false, isPreview: false })
        : configExport;
    assert.equal(config.base, '/crew-v2/');
    const proxy = config.server?.proxy?.['/v2'];
    assert.ok(proxy && typeof proxy === 'object', 'Vite cần proxy /v2');
    assert.equal(proxy.target, 'http://127.0.0.1:49161');
  } finally {
    if (priorApiOrigin === undefined) delete process.env.CREW_V2_WEB_API_ORIGIN;
    else process.env.CREW_V2_WEB_API_ORIGIN = priorApiOrigin;
  }

  assert.ok(existsSync(sourceRoot), 'Thiếu v2/web/src');
  const files = sourceFiles(sourceRoot);
  assert.ok(files.length > 0, 'Workspace web chưa có source');
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const imports = source.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(|\bimport\s*|\brequire\s*\()\s*['"]([^'"]+)['"]/g,
    );
    for (const [, specifier] of imports) {
      assert.ok(specifier, `Import thiếu specifier ở ${relative(webRoot, file)}`);
      assert.doesNotMatch(specifier, /^(?:apps\/|packages\/shared\/|@crew\/|@crew-v1\/)/);
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier);
        assert.ok(
          target === webRoot || target.startsWith(`${webRoot}${sep}`),
          `${relative(webRoot, file)} import ra ngoài v2/web: ${specifier}`,
        );
      }
    }
  }
});
