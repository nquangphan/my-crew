import { describe, expect, it } from 'vitest';
import {
  DOCS_SNAPSHOT_MAX_BYTES,
  DocsSyncRequest,
  FlowsManifest,
  flowsForPath,
  normalizeDocsPath,
} from './docs-schemas.js';

const SHA = 'a'.repeat(40);
const manifestFile = { path: 'docs/flows.yaml', content: 'version: 1' };

describe('normalizeDocsPath', () => {
  it('accepts docs markdown and YAML and the root AGENTS.md, normalizing . and //', () => {
    expect(normalizeDocsPath('docs/index.md')).toBe('docs/index.md');
    expect(normalizeDocsPath('docs//flows/./a-b.md')).toBe('docs/flows/a-b.md');
    expect(normalizeDocsPath('AGENTS.md')).toBe('AGENTS.md');
    expect(normalizeDocsPath('docs/flows.yaml')).toBe('docs/flows.yaml');
  });

  it('rejects traversal, absolute paths, other roots and other extensions', () => {
    for (const bad of [
      'docs/../secrets.md',
      '../docs/x.md',
      '/docs/x.md',
      'docs\\x.md',
      'src/index.md',
      'docs/x.ts',
      'CLAUDE.md',
      'docs/a b.md',
      '',
    ]) {
      expect(normalizeDocsPath(bad), bad).toBeNull();
    }
  });
});

describe('DocsSyncRequest', () => {
  it('requires a 40-char SHA, allowed paths, unique paths and the manifest', () => {
    expect(DocsSyncRequest.safeParse({ commit: SHA, branch: 'main', files: [manifestFile] }).success).toBe(
      true,
    );
    expect(
      DocsSyncRequest.safeParse({ commit: 'abc123', branch: 'main', files: [manifestFile] }).success,
    ).toBe(false);
    expect(
      DocsSyncRequest.safeParse({
        commit: SHA,
        branch: 'main',
        files: [manifestFile, { path: 'docs/../x.md', content: '' }],
      }).success,
    ).toBe(false);
    expect(
      DocsSyncRequest.safeParse({
        commit: SHA,
        branch: 'main',
        files: [manifestFile, { path: 'docs//flows.yaml', content: '' }],
      }).success,
    ).toBe(false);
    expect(
      DocsSyncRequest.safeParse({
        commit: SHA,
        branch: 'main',
        files: [{ path: 'docs/index.md', content: '' }],
      }).success,
    ).toBe(false);
  });

  it('caps the snapshot at 5 MB', () => {
    const big = { path: 'docs/big.md', content: 'x'.repeat(DOCS_SNAPSHOT_MAX_BYTES) };
    expect(
      DocsSyncRequest.safeParse({ commit: SHA, branch: 'main', files: [manifestFile, big] }).success,
    ).toBe(false);
  });
});

describe('flowsForPath', () => {
  const manifest = FlowsManifest.parse({
    version: 1,
    source: { include: ['src/**'] },
    flows: {
      checkout: {
        title: 'Đặt hàng',
        doc: 'docs/flows/checkout.md',
        entrypoints: ['src/routes.ts'],
        files: ['src/cart.ts'],
        tests: ['test/cart.test.ts'],
      },
      payments: { title: 'Thanh toán', doc: 'docs/flows/payments.md', files: ['src/cart.ts'] },
    },
    shared: { 'src/db.ts': ['checkout', 'payments'] },
    unassigned: [{ path: 'scripts/reset.sh', reason: 'dev helper' }],
  });

  it('lists every owning flow with its role', () => {
    expect(flowsForPath(manifest, 'src/cart.ts').flows.map((f) => [f.flowId, f.role])).toEqual([
      ['checkout', 'file'],
      ['payments', 'file'],
    ]);
    expect(flowsForPath(manifest, 'src/db.ts').flows.map((f) => [f.flowId, f.role])).toEqual([
      ['checkout', 'shared'],
      ['payments', 'shared'],
    ]);
    expect(flowsForPath(manifest, 'src/routes.ts').flows[0]).toMatchObject({
      flowId: 'checkout',
      title: 'Đặt hàng',
      doc: 'docs/flows/checkout.md',
      role: 'entrypoint',
    });
  });

  it('reports unassigned reasons and unknown paths', () => {
    expect(flowsForPath(manifest, 'scripts/reset.sh')).toEqual({ flows: [], unassignedReason: 'dev helper' });
    expect(flowsForPath(manifest, 'nope.ts')).toEqual({ flows: [], unassignedReason: null });
  });
});
