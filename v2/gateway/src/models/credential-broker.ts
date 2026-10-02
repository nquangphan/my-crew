import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import type { SecurityBridge } from './security-bridge.ts';
export type SecretTransport = (channel: Readable) => Promise<void>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Callbacks are trusted composition ports, never renderer or model child callbacks. */
export class CredentialBroker {
  private readonly machineId: string;
  private readonly bridge: SecurityBridge;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly transports: ReadonlySet<SecretTransport>;
  constructor(machineId: string, bridge: SecurityBridge, transports: readonly SecretTransport[]) {
    if (!uuid.test(machineId)) throw new Error('INVALID_MACHINE');
    this.machineId = machineId;
    this.bridge = bridge;
    this.transports = new Set(transports);
  }
  private location(ref: string) {
    const [machine, provider, operation, extra] = ref.split('_');
    if (
      machine !== this.machineId ||
      !provider ||
      !operation ||
      extra ||
      !uuid.test(provider) ||
      !uuid.test(operation)
    )
      throw new Error('INVALID_CREDENTIAL_REF');
    return { service: `com.2pcrew.v2.${machine}.${provider}`, account: operation };
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action);
    this.tail = next.catch(() => {});
    return next;
  }
  async put(providerId: string, secret: Buffer, operationId: string = randomUUID()): Promise<string> {
    const ref = `${this.machineId}_${providerId}_${operationId}`,
      { service, account } = this.location(ref);
    if (!secret.length || secret.length > 8192) throw new Error('CREDENTIAL_INVALID');
    const copy = Buffer.from(secret);
    return this.serialize(async () => {
      try {
        const old = await this.bridge.read(service, account);
        if (old) {
          try {
            if (old.length !== copy.length || !timingSafeEqual(old, copy))
              throw new Error('CREDENTIAL_CONFLICT');
          } finally {
            old.fill(0);
          }
        } else await this.bridge.put(service, account, copy);
        const stored = await this.bridge.read(service, account);
        try {
          if (!stored || stored.length !== copy.length || !timingSafeEqual(stored, copy))
            throw new Error('CREDENTIAL_READBACK_FAILED');
        } finally {
          stored?.fill(0);
        }
        return ref;
      } catch (error) {
        throw new Error(
          error instanceof Error &&
            ['CREDENTIAL_CONFLICT', 'CREDENTIAL_READBACK_FAILED'].includes(error.message)
            ? error.message
            : 'CREDENTIAL_STORE_FAILED',
        );
      } finally {
        copy.fill(0);
      }
    });
  }
  async assertStored(ref: string): Promise<void> {
    const { service, account } = this.location(ref);
    let bytes: Buffer | null = null;
    try {
      bytes = await this.bridge.read(service, account);
      if (!bytes?.length) throw new Error('CREDENTIAL_MISSING');
    } catch {
      throw new Error('CREDENTIAL_MISSING');
    } finally {
      bytes?.fill(0);
    }
  }
  async withSecret(ref: string, callback: SecretTransport): Promise<void> {
    if (!this.transports.has(callback)) throw new Error('UNTRUSTED_TRANSPORT');
    const { service, account } = this.location(ref);
    let bytes: Buffer | null = null;
    let channel: Readable | undefined;
    try {
      bytes = await this.bridge.read(service, account);
      if (!bytes) throw new Error('CREDENTIAL_MISSING');
      channel = Readable.from([bytes]);
      await callback(channel);
    } catch {
      throw new Error('CREDENTIAL_TRANSPORT_FAILED');
    } finally {
      channel?.destroy();
      bytes?.fill(0);
    }
  }
  async remove(ref: string): Promise<void> {
    const { service, account } = this.location(ref);
    await this.serialize(async () => {
      try {
        await this.bridge.remove(service, account);
      } catch {
        throw new Error('CREDENTIAL_STORE_FAILED');
      }
    });
  }
}
