export type OwnedResource = {
  kind: 'database' | 'container' | 'listener' | 'scratch' | 'browser';
  id: string;
  ownershipNonce: string;
  startIdentity: string;
};

export type CleanupResult = {
  resourceId: string;
  state: 'removed' | 'stopped' | 'unknown';
  reason: string | null;
};

export interface FixtureHandle {
  readonly apiOrigin: string;
  readonly webOrigin: string;
  readonly ownerPassword: string;
  readonly dbName: string;
  readonly dbPort: number;
  readonly containerName: string;
  readonly containerImageDigest: string;
  readonly registryPath: string;
  readonly resources: readonly OwnedResource[];
  close(): Promise<readonly CleanupResult[]>;
}

export type ResourceCleanupPort = {
  deadlineMs?: number;
  readStartIdentity(signal: AbortSignal): Promise<string | null>;
  stop(signal: AbortSignal): Promise<boolean>;
  confirmStopped(signal: AbortSignal): Promise<boolean>;
  remove?(signal: AbortSignal): Promise<boolean>;
};

class CleanupDeadline extends Error {}

export async function boundedCleanupStep<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  milliseconds: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new CleanupDeadline('CLEANUP_DEADLINE'));
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function closeOwnedResource(
  resource: OwnedResource,
  port: ResourceCleanupPort,
): Promise<CleanupResult> {
  const unknown = (reason: string): CleanupResult => ({ resourceId: resource.id, state: 'unknown', reason });
  const step = async <T>(
    phase: string,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; reason: string }> => {
    try {
      return { ok: true, value: await boundedCleanupStep(operation, port.deadlineMs ?? 5_000) };
    } catch (error) {
      return { ok: false, reason: error instanceof CleanupDeadline ? `${phase}_DEADLINE` : 'CLEANUP_ERROR' };
    }
  };

  const identity = await step('IDENTITY', port.readStartIdentity);
  if (!identity.ok) return unknown(identity.reason);
  if (identity.value === null) return unknown('IDENTITY_UNKNOWN');
  if (identity.value !== resource.startIdentity) return unknown('IDENTITY_MISMATCH');

  const stopped = await step('STOP', port.stop);
  if (!stopped.ok) return unknown(stopped.reason);
  if (!stopped.value) return unknown('STOP_UNKNOWN');

  const verified = await step('STOP_VERIFY', port.confirmStopped);
  if (!verified.ok) return unknown(verified.reason);
  if (!verified.value) return unknown('STOP_UNVERIFIED');

  if (port.remove) {
    const removed = await step('REMOVE', port.remove);
    if (!removed.ok) return unknown(removed.reason);
    if (!removed.value) return unknown('REMOVE_UNVERIFIED');
  }
  return { resourceId: resource.id, state: port.remove ? 'removed' : 'stopped', reason: null };
}

export async function withFixture(run: (handle: FixtureHandle) => Promise<void>): Promise<void> {
  const handle = await startOwnedFixture();
  let runError: unknown;
  try {
    await run(handle);
  } catch (error) {
    runError = error;
  }
  let cleanupError: unknown;
  try {
    const results = await handle.close();
    if (results.some((result) => result.state === 'unknown')) {
      cleanupError = new Error('FIXTURE_CLEANUP_UNKNOWN');
    }
  } catch (error) {
    cleanupError = error;
  }
  if (runError && cleanupError)
    throw new AggregateError([runError, cleanupError], 'FIXTURE_RUN_AND_CLEANUP_FAILED');
  if (runError) throw runError;
  if (cleanupError) throw cleanupError;
}

import { startOwnedFixture } from '../../scripts/e2e-fixture.ts';
