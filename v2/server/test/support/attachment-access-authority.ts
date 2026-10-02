import { randomUUID } from 'node:crypto';
import type {
  AssistantDesignation,
  AssistantInputAuthority,
  AssistantReadSession,
} from '../../src/attachments/contracts.ts';
import { canonicalJson } from '../../src/journal/canonical.ts';
import { ApiError } from '../../src/platform/errors.ts';
export function assistantProtocolAuthority() {
  let designation: AssistantDesignation | null = null;
  let securityRevoked = false;
  const turns = new Map<
    string,
    {
      processInstanceId: string;
      policyReceiptId: string;
      modelKey: string;
      admission: AssistantReadSession['admission'];
    }
  >();
  const authority: AssistantInputAuthority = {
    async designation() {
      return designation;
    },
    async authorizeIssue(_tx, actor) {
      if (actor.kind !== 'owner') throw new ApiError('FORBIDDEN', 403, 'Cần owner');
      if (!designation) throw new ApiError('ASSISTANT_INPUT_NOT_CONFIGURED', 409, 'Chưa có Trợ lý');
    },
    async authorizeSession(tx, actor, input) {
      if (!designation || actor.kind !== 'machine' || actor.id !== designation.machineId)
        throw new ApiError('NOT_FOUND', 404, 'Không có quyền');
      const [source] =
        await tx`select enabled,revision from model_source_configs where machine_id=${actor.id} for update`;
      if (!source?.enabled?.codex) throw new ApiError('SOURCE_DISABLED', 409, 'Nguồn đã tắt');
      if (turns.has(input.modelSelectionId))
        throw new ApiError('SELECTION_REUSED', 409, 'Lượt đã có admission');
      const turn = {
        processInstanceId: randomUUID(),
        policyReceiptId: randomUUID(),
        modelKey: canonicalJson({
          machineId: actor.id,
          runtime: 'codex',
          providerId: 'protocol-fixture',
          modelId: 'vision-fixture',
        }),
        admission: {
          id: randomUUID(),
          admittedAt: new Date().toISOString(),
          modelConfigRevision: Number(source.revision),
          sourceEnabledAtAdmission: true as const,
        },
      };
      turns.set(input.modelSelectionId, turn);
      return { ...turn, runtime: 'codex' };
    },
    async assertSessionCurrent(_tx, session) {
      const turn = turns.get(session.modelSelectionId);
      if (
        securityRevoked ||
        !turn ||
        turn.processInstanceId !== session.processInstanceId ||
        turn.policyReceiptId !== session.policyReceiptId ||
        turn.modelKey !== session.modelKey ||
        turn.admission.id !== session.admission.id ||
        turn.admission.modelConfigRevision !== session.admission.modelConfigRevision
      )
        throw new ApiError('POLICY_REVOKED', 409, 'Lượt không còn hợp lệ');
      // Exact admitted turn remains current after source config OFF; no new admission.
    },
  };
  return {
    authority,
    setMachine(machineId: string) {
      designation = {
        id: randomUUID(),
        ownerId: 'owner',
        machineId,
        revision: (designation?.revision ?? 0) + 1,
      };
    },
    revokeSecurity() {
      securityRevoked = true;
    },
    get admittedCount() {
      return turns.size;
    },
  };
}
