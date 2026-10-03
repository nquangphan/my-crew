import assert from 'node:assert/strict';
import type { Tx } from '../../src/platform/contracts.ts';

// Observe actual SQL rows and native membership operations, preserving values.
// Isolated serial fixture only: descriptors are restored before caller cleanup.
export async function observeSubsetSelectionWork<T>(
  tx: Tx,
  selectedIds: string[],
  read: (observed: Tx) => Promise<T>,
) {
  const expected = [...selectedIds].sort(),
    known = new Set(expected),
    includesDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'includes'),
    hasDescriptor = Object.getOwnPropertyDescriptor(Set.prototype, 'has');
  assert.ok(includesDescriptor && hasDescriptor);
  const nativeIncludes = Array.prototype.includes,
    nativeHas = Set.prototype.has,
    knownArrays = new WeakSet<object>(),
    knownSets = new WeakSet<object>();
  const work = {
    extractionQueries: 0,
    unitElementReads: 0,
    projectionKindReads: 0,
    membershipCalls: 0,
    membershipElementReads: 0,
    setMembershipCalls: 0,
    classificationElementReads: 0,
  };
  const sampled = [0, Math.floor(expected.length / 2), expected.length - 1];
  const exactArray = (value: unknown): value is string[] => {
    if (!Array.isArray(value) || value.length !== expected.length) return false;
    if (knownArrays.has(value)) return true;
    if (!sampled.every((i) => value[i] === expected[i])) return false;
    for (let i = 0; i < expected.length; i++) {
      work.classificationElementReads++;
      if (value[i] !== expected[i]) return false;
    }
    knownArrays.add(value);
    return true;
  };
  const exactSet = (value: Set<unknown>) => {
    if (value.size !== known.size) return false;
    if (knownSets.has(value)) return true;
    if (!sampled.every((i) => Reflect.apply(nativeHas, value, [expected[i]]))) return false;
    for (const id of value) {
      work.classificationElementReads++;
      if (!Reflect.apply(nativeHas, known, [id])) return false;
    }
    knownSets.add(value);
    return true;
  };
  const observed = new Proxy(tx, {
    apply(target, receiver, args) {
      const query = Reflect.apply(target, receiver, args),
        parts: unknown = args[0];
      if (
        !Array.isArray(parts) ||
        !parts.join('').includes('from attachment_extractions where attachment_id=')
      )
        return query;
      return query.then((rows: Record<string, unknown>[]) => {
        work.extractionQueries++;
        return rows.map((row) => {
          if (!row.manifest) return row;
          const manifest = row.manifest as { units: { locator: object }[] };
          const units = manifest.units.map((unit) => ({
            ...unit,
            locator: new Proxy(unit.locator, {
              get(value, property, receiver) {
                if (property === 'kind') work.projectionKindReads++;
                return Reflect.get(value, property, receiver);
              },
              getOwnPropertyDescriptor(value, property) {
                // canonicalJson reads descriptor.value rather than property get.
                if (property === 'kind') work.projectionKindReads++;
                return Reflect.getOwnPropertyDescriptor(value, property);
              },
            }),
          }));
          return {
            ...row,
            manifest: {
              ...manifest,
              units: new Proxy(units, {
                get(value, property, receiver) {
                  if (typeof property === 'string' && /^(0|[1-9][0-9]*)$/.test(property))
                    work.unitElementReads++;
                  return Reflect.get(value, property, receiver);
                },
              }),
            },
          };
        });
      });
    },
  });
  try {
    Object.defineProperty(Array.prototype, 'includes', {
      ...includesDescriptor,
      value: function (this: unknown[], ...args: unknown[]) {
        if (!exactArray(this)) return Reflect.apply(nativeIncludes, this, args);
        work.membershipCalls++;
        const measured = new Proxy(this, {
          get(value, property, receiver) {
            if (typeof property === 'string' && /^(0|[1-9][0-9]*)$/.test(property))
              work.membershipElementReads++;
            return Reflect.get(value, property, receiver);
          },
        });
        return Reflect.apply(nativeIncludes, measured, args);
      },
    });
    Object.defineProperty(Set.prototype, 'has', {
      ...hasDescriptor,
      value: function (this: Set<unknown>, id: unknown) {
        if (exactSet(this)) work.setMembershipCalls++;
        return Reflect.apply(nativeHas, this, [id]);
      },
    });
    const result = await read(observed);
    return { result, work };
  } finally {
    Object.defineProperty(Array.prototype, 'includes', includesDescriptor);
    Object.defineProperty(Set.prototype, 'has', hasDescriptor);
    assert.equal(Array.prototype.includes, nativeIncludes);
    assert.equal(Set.prototype.has, nativeHas);
  }
}
