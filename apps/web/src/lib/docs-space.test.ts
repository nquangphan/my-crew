import type { DocsPageSummary, FlowsManifest } from '@crew/shared';
import { describe, expect, it } from 'vitest';
import {
  blobUrl,
  buildPageTree,
  createSlugger,
  flowFiles,
  normalizeLookupPath,
  resolveDocsHref,
  resolveDocsTarget,
  stripLeadingTitle,
} from './docs-space';

const page = (path: string, title: string, kind: DocsPageSummary['kind'], flowId: string | null = null) => ({
  path,
  title,
  kind,
  flowId,
});

const pages: DocsPageSummary[] = [
  page('AGENTS.md', 'Hướng dẫn agent', 'agents'),
  page('docs/architecture.md', 'Kiến trúc', 'architecture'),
  page('docs/files.md', 'Tra cứu file', 'files'),
  page('docs/flows.yaml', 'flows.yaml', 'other'),
  page('docs/flows/webhook.md', 'Webhook', 'flow', 'webhook'),
  page('docs/flows/auth.md', 'Auth & session', 'flow', 'auth'),
  page('docs/flows/payments.md', 'Thanh toán', 'flow', 'payments'),
  page('docs/index.md', 'Tổng quan', 'index'),
  page('docs/glossary.md', 'Bảng thuật ngữ', 'other'),
];

const manifest: FlowsManifest = {
  version: 1,
  source: { include: ['src/**'], exclude: [] },
  flows: {
    payments: {
      title: 'Thanh toán',
      doc: 'docs/flows/payments.md',
      entrypoints: ['src/payment-routes.ts'],
      files: ['src/payment-service.ts'],
      tests: ['test/payment.test.ts'],
    },
    auth: { title: 'Auth & session', doc: 'docs/flows/auth.md', entrypoints: [], files: [], tests: [] },
  },
  shared: { 'src/db.ts': ['payments', 'auth'] },
  unassigned: [{ path: 'src/legacy.ts', reason: 'sắp xóa' }],
};

describe('buildPageTree', () => {
  it('groups the fixed pages, sorts flows by title and puts the rest under "Khác" with AGENTS.md first', () => {
    const tree = buildPageTree(pages);
    expect(tree.index?.path).toBe('docs/index.md');
    expect(tree.architecture?.path).toBe('docs/architecture.md');
    expect(tree.files?.path).toBe('docs/files.md');
    expect(tree.flows.map((p) => p.title)).toEqual(['Auth & session', 'Thanh toán', 'Webhook']);
    expect(tree.other.map((p) => p.path)).toEqual(['AGENTS.md', 'docs/glossary.md', 'docs/flows.yaml']);
  });
});

describe('resolveDocsTarget', () => {
  it('opens a flow by id, a page by path, else the space home', () => {
    expect(resolveDocsTarget(pages, manifest, { flow: 'payments' })).toMatchObject({
      kind: 'page',
      page: { path: 'docs/flows/payments.md' },
    });
    expect(resolveDocsTarget(pages, manifest, { path: 'AGENTS.md' })).toMatchObject({
      page: { path: 'AGENTS.md' },
    });
    expect(resolveDocsTarget(pages, manifest, {})).toMatchObject({ page: { path: 'docs/index.md' } });
  });

  it('reports an unknown flow or path', () => {
    expect(resolveDocsTarget(pages, manifest, { flow: 'nope' })).toEqual({
      kind: 'missing',
      what: 'flow',
      value: 'nope',
    });
    expect(resolveDocsTarget(pages, manifest, { path: 'docs/x.md' })).toEqual({
      kind: 'missing',
      what: 'path',
      value: 'docs/x.md',
    });
  });

  it('falls back to the first page of the tree without docs/index.md', () => {
    const noIndex = pages.filter((p) => p.kind !== 'index');
    expect(resolveDocsTarget(noIndex, manifest, {})).toMatchObject({
      page: { path: 'docs/architecture.md' },
    });
  });
});

describe('blobUrl', () => {
  const sha = 'a'.repeat(40);
  it('links https remotes without .git and encodes each path segment', () => {
    expect(blobUrl('https://github.com/2p/shop-api.git', sha, 'docs/flows/thanh toán#1.md')).toBe(
      `https://github.com/2p/shop-api/blob/${sha}/docs/flows/thanh%20to%C3%A1n%231.md`,
    );
    expect(blobUrl('https://github.com/2p/shop-api/', sha, 'a.ts')).toBe(
      `https://github.com/2p/shop-api/blob/${sha}/a.ts`,
    );
  });

  it('gives no link for ssh, http or odd remotes', () => {
    expect(blobUrl('git@github.com:2p/shop-api.git', sha, 'a.ts')).toBeNull();
    expect(blobUrl('http://github.com/2p/shop-api', sha, 'a.ts')).toBeNull();
    expect(blobUrl('javascript:alert(1)//x/', sha, 'a.ts')).toBeNull();
    expect(blobUrl('https://github.com/2p/shop-api', 'HEAD', 'a.ts')).toBeNull();
  });
});

describe('resolveDocsHref', () => {
  it('resolves relative and root links to repo paths', () => {
    expect(resolveDocsHref('docs/index.md', 'flows/payments.md')).toBe('docs/flows/payments.md');
    expect(resolveDocsHref('docs/flows/payments.md', '../architecture.md#muc')).toBe('docs/architecture.md');
    expect(resolveDocsHref('docs/flows/payments.md', './auth.md')).toBe('docs/flows/auth.md');
    expect(resolveDocsHref('docs/index.md', '/AGENTS.md')).toBe('AGENTS.md');
    expect(resolveDocsHref('docs/index.md', '../src/app%20x.ts')).toBe('src/app x.ts');
  });

  it('leaves external URLs, anchors and escapes above the root alone', () => {
    expect(resolveDocsHref('docs/index.md', 'https://example.com/a.md')).toBeNull();
    expect(resolveDocsHref('docs/index.md', 'mailto:a@b.c')).toBeNull();
    expect(resolveDocsHref('docs/index.md', '//evil.example/x')).toBeNull();
    expect(resolveDocsHref('docs/index.md', '#muc-dich')).toBeNull();
    expect(resolveDocsHref('docs/index.md', '../../x.md')).toBeNull();
  });
});

describe('flowFiles', () => {
  it('lists entry points, files, tests and the shared files of a flow', () => {
    expect(flowFiles(manifest, 'payments')).toEqual([
      { path: 'src/payment-routes.ts', role: 'entrypoint' },
      { path: 'src/payment-service.ts', role: 'file' },
      { path: 'test/payment.test.ts', role: 'test' },
      { path: 'src/db.ts', role: 'shared' },
    ]);
    expect(flowFiles(manifest, 'missing')).toEqual([]);
  });
});

describe('small text helpers', () => {
  it('slugs headings like GitHub and numbers repeats', () => {
    const slug = createSlugger();
    expect(slug('Mục đích')).toBe('mục-đích');
    expect(slug('Các bước (1/2)!')).toBe('các-bước-12');
    expect(slug('Mục đích')).toBe('mục-đích-1');
    expect(slug('Mục đích')).toBe('mục-đích-2');
    expect(slug('???')).toBe('muc');
  });

  it('normalizes typed lookup paths and drops a leading title line', () => {
    expect(normalizeLookupPath('  ./src/a.ts ')).toBe('src/a.ts');
    expect(normalizeLookupPath('/src\\a.ts')).toBe('src/a.ts');
    expect(stripLeadingTitle('\n# Tiêu đề\n\n## Mục')).toBe('\n## Mục');
    expect(stripLeadingTitle('Đoạn đầu\n# Không phải tiêu đề')).toBe('Đoạn đầu\n# Không phải tiêu đề');
  });
});
