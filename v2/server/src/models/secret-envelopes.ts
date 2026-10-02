import {
  createCipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { canonicalJson } from '../journal/canonical.ts';
import type { Id, Tx } from '../platform/contracts.ts';
import { readSourceConfig } from './config.ts';
import type {
  CredentialKeyConfirmation,
  CredentialKeyRegistration,
  SecretAck,
  SecretEnvelope,
  SecretInput,
} from './contracts.ts';
import { fail, hash, receiptExpiry } from './helpers.ts';

// Routes already hold this authority lock; direct service callers must share the same ordering.
async function lockCredentialMachine(tx: Tx, machineId: Id) {
  const [machine] = await tx`select revoked_at from machines where id=${machineId} for update`;
  if (!machine || machine.revoked_at) fail('NOT_FOUND', 404);
}

function publicKey(encoded: string) {
  try {
    const bytes = Buffer.from(encoded, 'base64'),
      key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
    if (
      key.asymmetricKeyType !== 'x25519' ||
      key.export({ format: 'der', type: 'spki' }).toString('base64') !== encoded
    )
      fail('KEY_INVALID', 400);
    return key;
  } catch {
    fail('KEY_INVALID', 400);
  }
}
export function sealSecret(publicKeyX25519: string, plaintext: string, aad: unknown) {
  const ephemeral = generateKeyPairSync('x25519'),
    nonce = randomBytes(12);
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: publicKey(publicKeyX25519) });
  const aes = Buffer.from(hkdfSync('sha256', shared, nonce, 'crew-v2-secret-envelope-v1', 32));
  const cipher = createCipheriv('aes-256-gcm', aes, nonce);
  cipher.setAAD(Buffer.from(canonicalJson(aad)));
  const clear = Buffer.from(plaintext);
  try {
    const ciphertext = Buffer.concat([cipher.update(clear), cipher.final()]);
    return {
      ephemeralPublicKey: ephemeral.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      nonce: nonce.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertextSha256: createHash('sha256').update(ciphertext).digest('hex'),
    };
  } finally {
    clear.fill(0);
    shared.fill(0);
    aes.fill(0);
  }
}
export async function registerCredentialKey(
  tx: Tx,
  machineId: Id,
  input: CredentialKeyRegistration,
  now = new Date(),
) {
  await lockCredentialMachine(tx, machineId);
  publicKey(input.publicKeyX25519);
  const [old] =
    await tx`select * from credential_keys where machine_id=${machineId} and key_id=${input.keyId}`;
  if (old) {
    if (old.public_key_x25519 !== input.publicKeyX25519) fail('KEY_ID_CONFLICT');
    const [ch] =
      await tx`select * from credential_key_challenges where machine_id=${machineId} and key_id=${input.keyId}`;
    if (!ch) fail('KEY_ID_CONFLICT');
    return {
      challengeId: ch.id,
      encryptedChallenge: ch.encrypted_challenge,
      expiresAt: (ch.expires_at as Date).toISOString(),
    };
  }
  const challengeId = randomUUID(),
    nonce = randomBytes(32).toString('hex'),
    expiresAt = receiptExpiry(now).toISOString();
  const box = sealSecret(input.publicKeyX25519, nonce, {
    machineId,
    keyId: input.keyId,
    challengeId,
    expiresAt,
  });
  await tx`insert into credential_keys(machine_id,key_id,public_key_x25519,state,created_at) values(${machineId},${input.keyId},${input.publicKeyX25519},'pending',${now})`;
  await tx`insert into credential_key_challenges(id,machine_id,key_id,challenge_hash,encrypted_challenge,expires_at) values(${challengeId},${machineId},${input.keyId},${createHash('sha256').update(nonce).digest('hex')},${tx.json(box)},${expiresAt})`;
  return { challengeId, encryptedChallenge: box, expiresAt };
}
export async function confirmCredentialKey(
  tx: Tx,
  machineId: Id,
  keyId: Id,
  input: CredentialKeyConfirmation,
  now = new Date(),
) {
  await lockCredentialMachine(tx, machineId);
  const [ch] =
    await tx`select * from credential_key_challenges where id=${input.challengeId} and machine_id=${machineId} and key_id=${keyId} for update`;
  if (
    !ch ||
    !timingSafeEqual(Buffer.from(String(ch.challenge_hash), 'hex'), Buffer.from(input.challengeSha256, 'hex'))
  )
    fail('KEY_PROOF_INVALID');
  if (ch.consumed_at) return { keyId, status: 'active' };
  if ((ch.expires_at as Date).getTime() <= now.getTime()) fail('KEY_CHALLENGE_EXPIRED');
  await tx`update credential_keys set state='retired' where machine_id=${machineId} and state='active' and lost_at is null`;
  await tx`update credential_keys set state='active',confirmed_at=${now} where machine_id=${machineId} and key_id=${keyId}`;
  await tx`update credential_key_challenges set consumed_at=${now} where id=${input.challengeId}`;
  return { keyId, status: 'active' };
}
export async function provisionSecret(
  tx: Tx,
  machineId: Id,
  providerId: Id,
  input: SecretInput,
  now = new Date(),
) {
  await lockCredentialMachine(tx, machineId);
  const requestHash = hash({ machineId, providerId, ...input });
  const [old] = await tx`select * from api_secret_envelopes where operation_id=${input.operationId}`;
  if (old) {
    if (old.machine_id !== machineId || old.provider_id !== providerId || old.request_hash !== requestHash)
      fail('SECRET_OPERATION_CONFLICT');
    return { operationId: input.operationId, status: old.state };
  }
  const config = await readSourceConfig(tx, machineId);
  if (!config || config.revision !== input.expectedRevision) fail('CONFIG_REVISION_CONFLICT');
  const [provider] =
    await tx`select * from api_providers where machine_id=${machineId} and id=${providerId} and declared for update`;
  const [binding] = await tx`select 1 from projects where machine_id=${machineId} limit 1`;
  if (!provider) fail('NOT_FOUND', 404);
  // Secret provisioning is machine scoped; binding is required before secret leaves server.
  if (!binding) fail('PROJECT_BINDING_REQUIRED');
  const [key] =
    await tx`select * from credential_keys where machine_id=${machineId} and key_id=${input.keyId} and state='active' and lost_at is null`;
  if (!key) fail('KEY_NOT_CONFIRMED');
  const expiresAt = receiptExpiry(now).toISOString(),
    aad = {
      machineId,
      providerId,
      keyId: input.keyId,
      configRevision: config.revision,
      operationId: input.operationId,
      expiresAt,
    };
  const box = sealSecret(String(key.public_key_x25519), input.secret, aad),
    id = randomUUID();
  const [cursor] = await tx`update api_secret_cursor set value=value+1 where singleton returning value`;
  await tx`insert into api_secret_envelopes(id,cursor,machine_id,provider_id,key_id,config_revision,operation_id,expires_at,ephemeral_public_key,nonce,ciphertext,tag,ciphertext_sha256,state,created_at,request_hash) values(${id},${cursor?.value},${machineId},${providerId},${input.keyId},${config.revision},${input.operationId},${expiresAt},${box.ephemeralPublicKey},${box.nonce},${box.ciphertext},${box.tag},${box.ciphertextSha256},'pending',${now},${requestHash})`;
  await tx`update api_providers set current_operation_id=${input.operationId},status='pending',credential_ref=null where machine_id=${machineId} and id=${providerId} and declared`;
  return { operationId: input.operationId, status: 'pending' };
}
export async function readSecretEnvelopes(tx: Tx, machineId: Id, after: string, now = new Date()) {
  const rows =
    await tx`select * from api_secret_envelopes where machine_id=${machineId} and state='pending' and expires_at>${now} and cursor>${after} order by cursor limit 100`;
  const items: SecretEnvelope[] = rows.map((r) => ({
    id: String(r.id),
    machineId,
    providerId: String(r.provider_id),
    keyId: String(r.key_id),
    configRevision: Number(r.config_revision),
    operationId: String(r.operation_id),
    expiresAt: (r.expires_at as Date).toISOString(),
    ephemeralPublicKey: String(r.ephemeral_public_key),
    nonce: String(r.nonce),
    ciphertext: String(r.ciphertext),
    tag: String(r.tag),
    ciphertextSha256: String(r.ciphertext_sha256),
  }));
  return {
    items,
    nextCursor: rows.length ? String(rows.at(-1)?.cursor) : after,
    serverTime: now.toISOString(),
  };
}
export async function ackSecret(tx: Tx, machineId: Id, id: Id, input: SecretAck, now = new Date()) {
  await lockCredentialMachine(tx, machineId);
  const [r] =
    await tx`select * from api_secret_envelopes where id=${id} and machine_id=${machineId} for update`;
  if (!r) fail('NOT_FOUND', 404);
  const ackHash = hash(input);
  if (
    r.operation_id !== input.operationId ||
    r.key_id !== input.keyId ||
    r.ciphertext_sha256 !== input.ciphertextSha256
  )
    fail('SECRET_ACK_MISMATCH');
  if (r.state === 'acked') {
    if (r.ack_hash !== ackHash) fail('SECRET_ACK_CONFLICT');
    return { operationId: input.operationId, status: 'acked' };
  }
  if (r.state !== 'pending' || (r.expires_at as Date).getTime() <= now.getTime()) fail('SECRET_EXPIRED');
  const config = await readSourceConfig(tx, machineId);
  if (config?.revision !== Number(r.config_revision)) fail('CONFIG_REVISION_CONFLICT');
  await tx`update api_secret_envelopes set state='acked',ciphertext=null,tag=null,acked_at=${now},ack_hash=${ackHash} where id=${id}`;
  await tx`update api_providers set status='stored',credential_ref=${input.credentialRef} where machine_id=${machineId} and id=${r.provider_id} and current_operation_id=${r.operation_id}`;
  return { operationId: input.operationId, status: 'acked' };
}
export async function markSecretKeyLost(tx: Tx, machineId: Id, id: Id, now = new Date()) {
  await lockCredentialMachine(tx, machineId);
  const [r] =
    await tx`select * from api_secret_envelopes where id=${id} and machine_id=${machineId} for update`;
  if (!r) fail('NOT_FOUND', 404);
  if (r.state === 'acked') fail('SECRET_ACK_CONFLICT');
  // Lost transport key is distinct from normal rotation and from already stored generic secrets.
  await tx`update credential_keys set state='retired',lost_at=coalesce(lost_at,${now}) where machine_id=${machineId} and key_id=${r.key_id}`;
  await tx`update api_secret_envelopes set state=case when expires_at<=${now} then 'expired' else 'key_lost' end,ciphertext=null,tag=null where machine_id=${machineId} and key_id=${r.key_id} and state='pending'`;
  // Only a current pending operation using this lost key may change provider presentation.
  await tx`update api_providers p set status='missing',credential_ref=null where p.machine_id=${machineId} and p.status='pending' and exists(select 1 from api_secret_envelopes e where e.machine_id=p.machine_id and e.provider_id=p.id and e.operation_id=p.current_operation_id and e.key_id=${r.key_id})`;
  return { operationId: r.operation_id, status: 'pending' };
}
