import type { LogicalEffect, ToolInvocation } from './contracts.ts';
import { type DurableEffectLedger, deriveEffectId } from './effect-ledger.ts';
export type Decision =
  | { kind: 'allow' }
  | { kind: 'deny' | 'wait'; reason: string }
  | { kind: 'execute' | 'return-receipt' | 'reconcile'; effectId: string };
export type ToolCall = {
  name: string;
  effectful: boolean;
  effect?: LogicalEffect;
  invocation?: ToolInvocation;
};
/** Broker policy only. Native/child bypass remains the isolation observer's responsibility. */
export class ToolPolicy {
  private readonly allowed: ReadonlySet<string>;
  private readonly readonlyTools: ReadonlySet<string>;
  private readonly ledger?: DurableEffectLedger;
  constructor(
    options: { allowedTools?: string[]; readOnlyTools?: string[]; ledger?: DurableEffectLedger } = {},
  ) {
    this.allowed = new Set(options.allowedTools ?? []);
    this.ledger = options.ledger;
    this.readonlyTools = new Set(options.readOnlyTools ?? []);
  }
  async authorize(call: ToolCall): Promise<Decision> {
    call = structuredClone(call);
    if (!this.allowed.has(call.name)) return { kind: 'deny', reason: 'TOOL_NOT_ALLOWED' };
    if (!call.effectful)
      return this.readonlyTools.has(call.name)
        ? { kind: 'allow' }
        : { kind: 'deny', reason: 'TOOL_EFFECT_MISMATCH' };
    if (
      !call.effect ||
      !call.invocation ||
      !call.effect.stepOperationId ||
      !call.effect.targetIdentity ||
      !call.effect.preconditionSha256
    )
      return { kind: 'wait', reason: 'LOGICAL_OPERATION_REQUIRED' };
    if (
      !call.effect.effectId ||
      deriveEffectId(call.effect) !== call.effect.effectId ||
      call.invocation.effectId !== call.effect.effectId
    )
      return { kind: 'deny', reason: 'EFFECT_ID_REQUIRED' };
    if (!this.ledger) return { kind: 'wait', reason: 'LOGICAL_AUTHORITY_NOT_BOUND' };
    const kind = await this.ledger.reserve(call.effect, call.invocation);
    return kind === 'wait' ? { kind, reason: 'EFFECT_UNCERTAIN' } : { kind, effectId: call.effect.effectId };
  }
}
