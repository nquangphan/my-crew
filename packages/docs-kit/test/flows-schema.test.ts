import { describe, expect, it } from 'vitest';
import { FlowsManifest, flowsForPath } from '../src/flows-schema.js';

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
