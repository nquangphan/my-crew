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
  readStartIdentity(): Promise<string | null>;
  stop(): Promise<boolean>;
  confirmStopped(): Promise<boolean>;
  remove?(): Promise<boolean>;
};

export async function closeOwnedResource(
  resource: OwnedResource,
  port: ResourceCleanupPort,
): Promise<CleanupResult> {
  const unknown = (reason: string): CleanupResult => ({ resourceId: resource.id, state: 'unknown', reason });
  try {
    const current = await port.readStartIdentity();
    if (current === null) return unknown('IDENTITY_UNKNOWN');
    if (current !== resource.startIdentity) return unknown('IDENTITY_MISMATCH');
    if (!(await port.stop())) return unknown('STOP_UNKNOWN');
    if (!(await port.confirmStopped())) return unknown('STOP_UNVERIFIED');
    if (port.remove && !(await port.remove())) return unknown('REMOVE_UNVERIFIED');
    return { resourceId: resource.id, state: port.remove ? 'removed' : 'stopped', reason: null };
  } catch {
    return unknown('CLEANUP_ERROR');
  }
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
