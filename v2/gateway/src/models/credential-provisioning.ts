import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomUUID,
} from 'node:crypto';
import { join } from 'node:path';
import { AtomicRecords, canonicalJson, hash } from '../journal/atomic-records.ts';
import type { HttpOperationJournal } from '../journal/http-operations.ts';
import type { SecretAck, SecretEnvelope, SourceConfig } from './contracts.ts';
import type { CredentialBroker } from './credential-broker.ts';
import type { SecurityBridge } from './security-bridge.ts';
export class ServerReceiptClock {
  private readonly monotonic: () => number;
  private anchor: { server: number; mono: number } | null = null;
  constructor(monotonic = () => performance.now()) {
    this.monotonic = monotonic;
  }
  observe(serverTime: string): void {
    const server = Date.parse(serverTime),
      mono = this.monotonic();
    if (!Number.isFinite(server) || !Number.isFinite(mono)) throw new Error('SERVER_TIME_INVALID');
    // Replayed/backwards server clocks cannot move the expiry estimate backwards.
    const prior = this.anchor ? this.anchor.server + Math.max(0, mono - this.anchor.mono) : server;
    this.anchor = { server: Math.max(server, prior), mono };
  }
  assertFresh(expiresAt: string): void {
    if (!this.anchor) throw new Error('SERVER_TIME_REQUIRED');
    const elapsed = this.monotonic() - this.anchor.mono,
      expires = Date.parse(expiresAt);
    if (
      !Number.isFinite(expires) ||
      !Number.isFinite(elapsed) ||
      elapsed < 0 ||
      elapsed > 300000 ||
      expires <= this.anchor.server + elapsed ||
      expires > this.anchor.server + elapsed + 300000
    )
      throw new Error('SECRET_EXPIRED');
  }
}
type Box = {
  ephemeralPublicKey: string;
  nonce: string;
  ciphertext: string;
  tag: string;
  ciphertextSha256: string;
};
function decode(value: string, min: number, max = min): Buffer {
  const b = Buffer.from(value, 'base64');
  if (b.toString('base64') !== value || b.length < min || b.length > max) throw new Error('ENVELOPE_INVALID');
  return b;
}
function openBox(privateBytes: Buffer, box: Box, aad: unknown): Buffer {
  let shared: Buffer | undefined, aes: Buffer | undefined, partial: Buffer | undefined;
  try {
    const key = createPrivateKey({ key: privateBytes, format: 'der', type: 'pkcs8' }),
      pubBytes = decode(box.ephemeralPublicKey, 44, 200),
      pub = createPublicKey({ key: pubBytes, format: 'der', type: 'spki' });
    if (
      key.asymmetricKeyType !== 'x25519' ||
      pub.asymmetricKeyType !== 'x25519' ||
      !pub.export({ type: 'spki', format: 'der' }).equals(pubBytes)
    )
      throw new Error();
    const nonce = decode(box.nonce, 12),
      tag = decode(box.tag, 16),
      ciphertext = decode(box.ciphertext, 1, 8192);
    if (hash(ciphertext) !== box.ciphertextSha256) throw new Error();
    shared = diffieHellman({ privateKey: key, publicKey: pub });
    aes = Buffer.from(hkdfSync('sha256', shared, nonce, 'crew-v2-secret-envelope-v1', 32));
    const decipher = createDecipheriv('aes-256-gcm', aes, nonce);
    decipher.setAAD(Buffer.from(canonicalJson(aad)));
    decipher.setAuthTag(tag);
    partial = decipher.update(ciphertext);
    return Buffer.concat([partial, decipher.final()]);
  } catch {
    throw new Error('ENVELOPE_INVALID');
  } finally {
    shared?.fill(0);
    aes?.fill(0);
    partial?.fill(0);
  }
}
type KeyRecord = { formatVersion: 1; id: string; publicKey: string | null; confirmed?: boolean };
type AckIntent = { formatVersion: 1; envelopeHash: string; ack: SecretAck };
export class CredentialProvisioning {
  private readonly store: AtomicRecords;
  private readonly machineId: string;
  private readonly bridge: SecurityBridge;
  private readonly broker: CredentialBroker;
  private readonly http: HttpOperationJournal;
  private readonly clock: ServerReceiptClock;
  private constructor(
    store: AtomicRecords,
    machineId: string,
    bridge: SecurityBridge,
    broker: CredentialBroker,
    http: HttpOperationJournal,
    clock: ServerReceiptClock,
  ) {
    this.store = store;
    this.machineId = machineId;
    this.bridge = bridge;
    this.broker = broker;
    this.http = http;
    this.clock = clock;
  }
  static async open(
    root: string,
    machineId: string,
    bridge: SecurityBridge,
    broker: CredentialBroker,
    http: HttpOperationJournal,
    clock: ServerReceiptClock,
  ): Promise<CredentialProvisioning> {
    return new CredentialProvisioning(
      await AtomicRecords.open(join(root, 'credential-provisioning')),
      machineId,
      bridge,
      broker,
      http,
      clock,
    );
  }
  private service() {
    return `com.2pcrew.v2.${this.machineId}.credential-keys`;
  }
  async registerKey(): Promise<string> {
    return this.store.transaction(async () => {
      let record = await this.store.get<KeyRecord>('active-key');
      if (!record) {
        record = { formatVersion: 1, id: randomUUID(), publicKey: null };
        await this.store.put('active-key', record);
      }
      let privateBytes = await this.bridge.read(this.service(), record.id);
      try {
        if (!privateBytes) {
          if (record.publicKey) throw new Error('KEY_LOST');
          const keys = generateKeyPairSync('x25519');
          privateBytes = keys.privateKey.export({ type: 'pkcs8', format: 'der' });
          await this.bridge.put(this.service(), record.id, privateBytes);
          const check = await this.bridge.read(this.service(), record.id);
          try {
            if (!check?.equals(privateBytes)) throw new Error('KEY_READBACK_FAILED');
          } finally {
            check?.fill(0);
          }
        }
        const privateKey = createPrivateKey({ key: privateBytes, format: 'der', type: 'pkcs8' }),
          publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64');
        if (record.publicKey && record.publicKey !== publicKey) throw new Error('KEY_LOST');
        record.publicKey = publicKey;
        await this.store.put('active-key', record);
        if (record.confirmed) return record.id;
        const registrationId = `credential-register:${record.id}`;
        await this.http.prepare({
          operationId: registrationId,
          method: 'POST',
          route: '/v2/machine/credential-keys',
          phase: 'credential-register',
          canonicalBody: { keyId: record.id, publicKeyX25519: publicKey },
        });
        const response = await this.http.replay(registrationId);
        if (response.status < 200 || response.status >= 300) throw new Error('KEY_REGISTRATION_REJECTED');
        const challenge = response.body as {
          challengeId: string;
          expiresAt: string;
          encryptedChallenge: Box;
        };
        this.clock.assertFresh(challenge.expiresAt);
        const clear = openBox(privateBytes, challenge.encryptedChallenge, {
          machineId: this.machineId,
          keyId: record.id,
          challengeId: challenge.challengeId,
          expiresAt: challenge.expiresAt,
        });
        let digest: string;
        try {
          digest = hash(clear);
        } finally {
          clear.fill(0);
        }
        const confirmationId = `credential-confirm:${record.id}`;
        await this.http.prepare({
          operationId: confirmationId,
          method: 'POST',
          route: `/v2/machine/credential-keys/${record.id}/confirm`,
          phase: 'credential-confirm',
          canonicalBody: { challengeId: challenge.challengeId, challengeSha256: digest },
        });
        const confirmation = await this.http.replay(confirmationId);
        if (confirmation.status < 200 || confirmation.status >= 300)
          throw new Error('KEY_CONFIRMATION_REJECTED');
        record.confirmed = true;
        await this.store.put('active-key', record);
        return record.id;
      } finally {
        privateBytes?.fill(0);
      }
    });
  }
  async accept(
    envelope: SecretEnvelope,
    currentRevision: number,
    allowedProviders: readonly string[],
  ): Promise<string> {
    if (envelope.machineId !== this.machineId) throw new Error('ENVELOPE_SCOPE_INVALID');
    const digest = hash(canonicalJson(envelope));
    return this.store.transaction(async () => {
      const old = await this.store.get<AckIntent>(envelope.id);
      if (old && old.envelopeHash !== digest) throw new Error('ENVELOPE_INVALID');
      if (old) return this.replayAck(envelope.id);
      // Historical ACK intent is immutable recovery, not fresh provisioning authority.
      if (!allowedProviders.includes(envelope.providerId)) throw new Error('ENVELOPE_SCOPE_INVALID');
      if (envelope.configRevision !== currentRevision) throw new Error('CONFIG_REVISION_CONFLICT');
      this.clock.assertFresh(envelope.expiresAt);
      const privateBytes = await this.bridge.read(this.service(), envelope.keyId);
      if (!privateBytes) {
        const operationId = `credential-key-lost:${envelope.id}`;
        await this.http.prepare({
          operationId,
          method: 'POST',
          route: `/v2/machine/api-secret-envelopes/${envelope.id}/key-lost`,
          phase: 'credential-key-lost',
          canonicalBody: {},
        });
        await this.http.replay(operationId);
        throw new Error('KEY_LOST');
      }
      let clear: Buffer | undefined;
      try {
        clear = openBox(privateBytes, envelope, {
          machineId: this.machineId,
          providerId: envelope.providerId,
          keyId: envelope.keyId,
          configRevision: envelope.configRevision,
          operationId: envelope.operationId,
          expiresAt: envelope.expiresAt,
        });
        const credentialRef = await this.broker.put(envelope.providerId, clear, envelope.id);
        const ack: SecretAck = {
          operationId: envelope.operationId,
          keyId: envelope.keyId,
          ciphertextSha256: envelope.ciphertextSha256,
          credentialRef,
        };
        // Write/read-back completed before durable ACK intent; no clear bytes in either journal.
        await this.store.put(envelope.id, { formatVersion: 1, envelopeHash: digest, ack });
        const operationId = `credential-ack:${envelope.id}`;
        await this.http.prepare({
          operationId,
          method: 'POST',
          route: `/v2/machine/api-secret-envelopes/${envelope.id}/ack`,
          phase: 'credential-ack',
          canonicalBody: ack,
        });
        const response = await this.http.replay(operationId);
        if (response.status < 200 || response.status >= 300) throw new Error('SECRET_ACK_REJECTED');
        return credentialRef;
      } finally {
        privateBytes.fill(0);
        clear?.fill(0);
      }
    });
  }
  async replayAck(envelopeId: string): Promise<string> {
    const intent = await this.store.get<AckIntent>(envelopeId);
    if (!intent) throw new Error('ACK_INTENT_MISSING');
    await this.broker.assertStored(intent.ack.credentialRef);
    // Only previously durable write/read-back intent may replay, including historical server ACK.
    const operationId = `credential-ack:${envelopeId}`;
    await this.http.prepare({
      operationId,
      method: 'POST',
      route: `/v2/machine/api-secret-envelopes/${envelopeId}/ack`,
      phase: 'credential-ack',
      canonicalBody: intent.ack,
    });
    const response = await this.http.replay(operationId);
    if (response.status < 200 || response.status >= 300) throw new Error('SECRET_ACK_REJECTED');
    return intent.ack.credentialRef;
  }
  async rotateKey(): Promise<string> {
    await this.store.transaction(async () => {
      const old = await this.store.get<KeyRecord>('active-key');
      if (old) await this.store.put(`key-history:${old.id}`, old);
      // Keep retired private keys for their own pending envelopes; no deletion by age.
      await this.store.put('active-key', { formatVersion: 1, id: randomUUID(), publicKey: null });
    });
    return this.registerKey();
  }
  async syncPending(
    read: (route: string) => Promise<unknown>,
  ): Promise<{ state: 'disabled' | 'pending' | 'stored'; nextCursor: string }> {
    const config = (await read('/v2/machine/model-sources')) as SourceConfig | null;
    if (!config) return { state: 'pending', nextCursor: '0' };
    if (!config.enabled.api) return { state: 'disabled', nextCursor: '0' };
    const cursor = await this.store.get<{ formatVersion: 1; cursor: string }>('envelope-cursor');
    const batch = (await read(`/v2/machine/api-secret-envelopes?after=${cursor?.cursor ?? '0'}`)) as {
      items: SecretEnvelope[];
      nextCursor: string;
      serverTime: string;
    };
    if (
      !batch ||
      !Array.isArray(batch.items) ||
      batch.items.length > 100 ||
      !/^(0|[1-9][0-9]*)$/.test(batch.nextCursor) ||
      BigInt(batch.nextCursor) < BigInt(cursor?.cursor ?? '0')
    )
      throw new Error('ENVELOPE_BATCH_INVALID');
    this.clock.observe(batch.serverTime);
    await this.store.transaction(async () => {
      for (const envelope of batch.items) {
        if (envelope.machineId !== this.machineId) throw new Error('ENVELOPE_SCOPE_INVALID');
        const id = `pending-envelope:${envelope.id}`,
          old = await this.store.get<{ formatVersion: 1; envelope: SecretEnvelope | null }>(id);
        if (old?.envelope && canonicalJson(old.envelope) !== canonicalJson(envelope))
          throw new Error('ENVELOPE_INVALID');
        if (!old) await this.store.put(id, { formatVersion: 1, envelope });
      }
      // Cursor advances only after every encrypted envelope is durable; failed ACKs remain queued.
      await this.store.put('envelope-cursor', { formatVersion: 1, cursor: batch.nextCursor });
    });
    // Only a fresh desired read may confirm current provider storage, never a historical ACK.
    let pending = config.apiProviders.some((p) => p.credentialStatus !== 'stored');
    try {
      await this.registerKey();
    } catch {
      pending = config.apiProviders.some((p) => p.credentialStatus !== 'stored');
    }
    const providers = config.apiProviders.map((p) => p.id);
    for (const row of await this.store.all<{ formatVersion: 1; envelope?: SecretEnvelope | null }>()) {
      if (!row.envelope) continue;
      try {
        await this.accept(row.envelope, config.revision, providers);
        await this.store.put(`pending-envelope:${row.envelope.id}`, { formatVersion: 1, envelope: null });
      } catch {
        // Keep encrypted history for re-entry/replay; it cannot demote a different current stored secret.
        const current = config.apiProviders.find((p) => p.id === row.envelope?.providerId);
        if (current && current.credentialStatus !== 'stored') pending = true;
      }
    }
    return { state: pending ? 'pending' : 'stored', nextCursor: batch.nextCursor };
  }
  close(): Promise<void> {
    return this.store.close();
  }
}
