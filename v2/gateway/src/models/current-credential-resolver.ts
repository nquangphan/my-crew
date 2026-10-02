import type { ApiCredentialBindings, ApiProviderConfig, SourceConfig } from './contracts.ts';
import type { CredentialBroker } from './credential-broker.ts';

export type ResolvedCredential = {
  credentialRef: string;
  assertCurrent: () => Promise<void>;
};
/** Authenticated machine HTTP reads; sampled state is not a network lease or dispatch permit. */
export class CurrentCredentialResolver {
  private readonly machineId: string;
  private readonly read: (path: string, signal: AbortSignal) => Promise<unknown>;
  private readonly broker: CredentialBroker;
  constructor(
    machineId: string,
    read: (path: string, signal: AbortSignal) => Promise<unknown>,
    broker: CredentialBroker,
  ) {
    this.machineId = machineId;
    this.read = read;
    this.broker = broker;
  }
  private async readBounded(path: string, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    let abort = () => {};
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(new Error('CREDENTIAL_READ_ABORTED'));
      signal.addEventListener('abort', abort, { once: true });
    });
    try {
      return await Promise.race([this.read(path, signal), interrupted]);
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }
  async resolve(
    provider: ApiProviderConfig,
    revision: number,
    signal: AbortSignal,
  ): Promise<ResolvedCredential> {
    const expected = structuredClone(provider);
    const readCurrent = async () => {
      const desired = (await this.readBounded('/v2/machine/model-sources', signal)) as SourceConfig | null;
      const snapshot = (await this.readBounded(
        '/v2/machine/api-credential-bindings',
        signal,
      )) as ApiCredentialBindings | null;
      const providers = desired?.apiProviders?.filter((p) => p.id === expected.id);
      const bindings = snapshot?.providers?.filter((p) => p.providerId === expected.id);
      const configured = providers?.[0],
        binding = bindings?.[0];
      if (
        !Number.isSafeInteger(revision) ||
        revision < 1 ||
        desired?.revision !== revision ||
        desired.enabled.api !== true ||
        snapshot?.machineId !== this.machineId ||
        snapshot.configRevision !== revision ||
        snapshot.apiEnabled !== true ||
        providers?.length !== 1 ||
        bindings?.length !== 1 ||
        !configured ||
        !binding ||
        configured.credentialStatus !== 'stored' ||
        binding.status !== 'stored' ||
        configured.endpoint !== expected.endpoint ||
        configured.protocol !== expected.protocol ||
        JSON.stringify(configured.localHttp) !== JSON.stringify(expected.localHttp) ||
        JSON.stringify(configured.models) !== JSON.stringify(expected.models) ||
        binding.endpoint !== expected.endpoint ||
        binding.protocol !== expected.protocol ||
        typeof binding.credentialRef !== 'string' ||
        !binding.credentialRef.startsWith(`${this.machineId}_${expected.id}_`) ||
        !(binding.currentOperationId === null || typeof binding.currentOperationId === 'string')
      )
        throw new Error('CREDENTIAL_BINDING_UNAVAILABLE');
      await this.broker.assertStored(binding.credentialRef);
      signal.throwIfAborted();
      return { credentialRef: binding.credentialRef, currentOperationId: binding.currentOperationId };
    };
    const pinned = await readCurrent();
    return {
      credentialRef: pinned.credentialRef,
      assertCurrent: async () => {
        const current = await readCurrent();
        if (
          current.credentialRef !== pinned.credentialRef ||
          current.currentOperationId !== pinned.currentOperationId
        )
          throw new Error('CREDENTIAL_BINDING_CHANGED');
      },
    };
  }
}
