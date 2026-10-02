import { createHash } from 'node:crypto';
import { canonicalJson } from '../journal/canonical.ts';
import { appendEvent } from '../journal/events.ts';
import type { Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type { ProbeContext } from './contracts.ts';
export const same = (a: unknown, b: unknown) =>
  a === b || (a !== undefined && b !== undefined && canonicalJson(a) === canonicalJson(b));
export const hash = (a: unknown) => createHash('sha256').update(canonicalJson(a)).digest('hex');
export const json = (a: unknown) => JSON.parse(canonicalJson(a));
export function fail(code: string, status = 409): never {
  throw new ApiError(code, status, 'Cấu hình model không còn hợp lệ');
}
/** Wire context hash has fixed field ordering, distinct from generic sorted canonical JSON. */
export function contextHash(c: ProbeContext): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        sourceTreeSha256: c.sourceTreeSha256,
        projectionManifestSha256: c.projectionManifestSha256,
        projectionTreeSha256: c.projectionTreeSha256,
        derivationSha256: c.derivationSha256,
        binarySha256: c.binarySha256,
        policySha256: c.policySha256,
        osVersion: c.osVersion,
      }),
    )
    .digest('hex');
}
export async function modelEvent(tx: Tx, machineId: string, type: string, data: Record<string, unknown>) {
  await appendEvent(tx, { type, projectId: null, ticketId: null, audienceMachineId: machineId, data });
}
export const receiptExpiry = (now: Date) => new Date(now.getTime() + 5 * 60_000);
