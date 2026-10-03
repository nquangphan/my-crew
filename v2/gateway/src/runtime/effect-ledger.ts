import { join } from 'node:path';
import { AtomicRecords, canonicalJson, hash, writeExclusiveRecord } from '../journal/atomic-records.ts';
import type { EffectLedger, EffectReceipt, LogicalEffect, ToolInvocation } from './contracts.ts';

const digest = /^[0-9a-f]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Identity = Pick<
  LogicalEffect,
  'runId' | 'stepOperationId' | 'actionKind' | 'targetIdentity' | 'preconditionSha256'
>;
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function invalid(): never {
  throw new Error('INVALID_EFFECT');
}
function conflict(): never {
  throw Object.assign(new Error('EFFECT_CONFLICT'), { code: 'EFFECT_CONFLICT', statusCode: 409 });
}
export function deriveEffectId(e: Identity): string {
  if (
    !uuid.test(e.runId) ||
    !uuid.test(e.stepOperationId) ||
    !digest.test(e.preconditionSha256) ||
    typeof e.actionKind !== 'string' ||
    !e.actionKind.trim() ||
    e.actionKind.length > 256 ||
    typeof e.targetIdentity !== 'string' ||
    !e.targetIdentity.trim() ||
    e.targetIdentity.length > 8192
  )
    invalid();
  return hash(
    canonicalJson([e.runId, e.stepOperationId, e.actionKind, e.targetIdentity, e.preconditionSha256]),
  );
}
function validateCall(call: ToolInvocation) {
  if (
    !uuid.test(call.attemptId) ||
    !uuid.test(call.stepOperationId) ||
    !/^[1-9][0-9]*$/.test(call.fence) ||
    !digest.test(call.argsSha256) ||
    !digest.test(call.effectId) ||
    typeof call.toolCallId !== 'string' ||
    !call.toolCallId.length ||
    call.toolCallId.length > 1024
  )
    invalid();
}
function validateReceipt(receipt: EffectReceipt) {
  if (
    !digest.test(receipt.sha256) ||
    !Array.isArray(receipt.artifactIds) ||
    receipt.artifactIds.some((id) => !uuid.test(id)) ||
    new Set(receipt.artifactIds).size !== receipt.artifactIds.length
  )
    invalid();
}
type Intent = { formatVersion: 1; effect: LogicalEffect; argsSha256: string };
type Binding = { formatVersion: 1; call: ToolInvocation };
type ReceiptRecord = { formatVersion: 1; effectId: string; receipt: EffectReceipt };
export type EffectAuthority = {
  /** Phase06 durable logical-operation authority; never inferred from provider IDs/arguments. */
  authorizeOperation?: (effect: LogicalEffect, call: ToolInvocation) => Promise<boolean>;
  /** Verify actual result bytes plus every artifact before recording AND returning a receipt. */
  verifyReceipt?: (effect: LogicalEffect, receipt: EffectReceipt) => Promise<boolean>;
  /** Target-specific durable observation. null cannot justify replaying the side effect. */
  reconcileTarget?: (effect: LogicalEffect) => Promise<EffectReceipt | null>;
};
export class DurableEffectLedger implements EffectLedger {
  private readonly store: AtomicRecords;
  private readonly authority: Readonly<EffectAuthority>;
  private constructor(store: AtomicRecords, authority: EffectAuthority) {
    this.store = store;
    this.authority = Object.freeze({ ...authority });
  }
  static async open(root: string, authority: EffectAuthority = {}) {
    return new DurableEffectLedger(await AtomicRecords.open(join(root, 'logical-effects')), authority);
  }
  private callKey(call: ToolInvocation) {
    return `call:${canonicalJson([call.attemptId, call.fence, call.toolCallId])}`;
  }
  private async append(key: string, value: unknown) {
    await writeExclusiveRecord(this.store.path(key), value);
  }
  async reserve(effect: LogicalEffect, call: ToolInvocation): ReturnType<EffectLedger['reserve']> {
    effect = structuredClone(effect);
    call = structuredClone(call);
    validateCall(call);
    if (
      deriveEffectId(effect) !== effect.effectId ||
      !uuid.test(effect.stepId) ||
      call.effectId !== effect.effectId ||
      call.stepOperationId !== effect.stepOperationId ||
      effect.state !== 'pending' ||
      effect.receiptSha256 !== null ||
      effect.artifactIds.length
    )
      invalid();
    return this.store.transaction(async () => {
      const binding = await this.store.get<Binding>(this.callKey(call));
      if (binding && !same(binding.call, call)) conflict();
      const key = `intent:${effect.effectId}`,
        existing = await this.store.get<Intent>(key);
      if (existing && (!same(existing.effect, effect) || existing.argsSha256 !== call.argsSha256)) conflict();
      if (
        !this.authority.authorizeOperation ||
        !(await this.authority.authorizeOperation(structuredClone(effect), structuredClone(call)))
      )
        return 'wait';
      if (!binding) await this.append(this.callKey(call), { formatVersion: 1, call });
      if (!existing) {
        await this.append(key, { formatVersion: 1, effect, argsSha256: call.argsSha256 });
        return 'execute';
      }
      const receipt = await this.store.get<ReceiptRecord>(`receipt:${effect.effectId}`);
      if (receipt) return (await this.verified(effect, receipt.receipt)) ? 'return-receipt' : 'wait';
      return (await this.store.get(`uncertain:${effect.effectId}`)) ? 'wait' : 'reconcile';
    });
  }
  private async verified(effect: LogicalEffect, receipt: EffectReceipt): Promise<boolean> {
    validateReceipt(receipt);
    return (
      !!this.authority.verifyReceipt &&
      this.authority.verifyReceipt(structuredClone(effect), structuredClone(receipt))
    );
  }
  private async persistReceipt(effect: LogicalEffect, receipt: EffectReceipt) {
    if (!(await this.verified(effect, receipt))) throw new Error('RECEIPT_UNVERIFIED');
    const key = `receipt:${effect.effectId}`,
      prior = await this.store.get<ReceiptRecord>(key);
    if (prior) {
      if (!same(prior.receipt, receipt)) conflict();
      return;
    }
    await this.append(key, { formatVersion: 1, effectId: effect.effectId, receipt });
  }
  async complete(effectId: string, call: ToolInvocation, receipt: EffectReceipt): Promise<void> {
    call = structuredClone(call);
    receipt = structuredClone(receipt);
    validateCall(call);
    validateReceipt(receipt);
    await this.store.transaction(async () => {
      const intent = await this.store.get<Intent>(`intent:${effectId}`),
        binding = await this.store.get<Binding>(this.callKey(call));
      if (
        !intent ||
        call.effectId !== effectId ||
        !binding ||
        !same(binding.call, call) ||
        intent.effect.stepOperationId !== call.stepOperationId
      )
        conflict();
      if (
        !this.authority.authorizeOperation ||
        !(await this.authority.authorizeOperation(structuredClone(intent.effect), structuredClone(call)))
      )
        throw new Error('OPERATION_UNVERIFIED');
      await this.persistReceipt(intent.effect, receipt);
    });
  }
  async receipt(effectId: string): Promise<EffectReceipt | null> {
    if (!digest.test(effectId)) invalid();
    return this.store.transaction(async () => {
      const intent = await this.store.get<Intent>(`intent:${effectId}`),
        done = await this.store.get<ReceiptRecord>(`receipt:${effectId}`);
      return intent && done && (await this.verified(intent.effect, done.receipt))
        ? structuredClone(done.receipt)
        : null;
    });
  }
  async reconcile(effectId: string): ReturnType<EffectLedger['reconcile']> {
    if (!digest.test(effectId)) invalid();
    return this.store.transaction(async () => {
      const intent = await this.store.get<Intent>(`intent:${effectId}`);
      if (!intent) return 'uncertain';
      const done = await this.store.get<ReceiptRecord>(`receipt:${effectId}`);
      if (done) return (await this.verified(intent.effect, done.receipt)) ? 'done' : 'uncertain';
      const recovered = await this.authority.reconcileTarget?.(structuredClone(intent.effect));
      if (recovered) {
        await this.persistReceipt(intent.effect, recovered);
        return 'done';
      }
      if (!(await this.store.get(`uncertain:${effectId}`)))
        await this.append(`uncertain:${effectId}`, { formatVersion: 1, effectId });
      return 'uncertain';
    });
  }
  close() {
    return this.store.close();
  }
}
