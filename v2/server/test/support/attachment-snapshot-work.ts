import assert from 'node:assert/strict';
import type { Tx } from '../../src/platform/contracts.ts';

// Observe real query results, not synthetic manifests or a production counter.
// Canonical hashing and membership scanning consume these numeric array reads.
// The SQL query and all original rows/values still come from private PostgreSQL.
export function observePersistedDerivativeWork(tx: Tx) {
  const work = { queries: 0, rows: 0, validationReads: 0, unitElementReads: 0 };
  const observed = new Proxy(tx, {
    apply(target, receiver, args) {
      const query = Reflect.apply(target, receiver, args);
      const parts: unknown = args[0];
      if (
        !Array.isArray(parts) ||
        !parts.join('').includes('from attachment_derivatives where extraction_id=')
      )
        return query;
      return query.then((rows: Record<string, unknown>[]) => {
        work.queries++;
        work.rows += rows.length;
        return rows.map((row) => {
          assert.ok(Array.isArray(row.unit_ids));
          const unitIds = new Proxy(row.unit_ids, {
            get(array, property, receiver) {
              if (typeof property === 'string' && /^(0|[1-9][0-9]*)$/.test(property)) work.unitElementReads++;
              return Reflect.get(array, property, receiver);
            },
          });
          return new Proxy(
            { ...row, unit_ids: unitIds },
            {
              get(value, property, receiver) {
                if (property === 'sha256') work.validationReads++;
                return Reflect.get(value, property, receiver);
              },
            },
          );
        });
      });
    },
  });
  return { tx: observed, work };
}
