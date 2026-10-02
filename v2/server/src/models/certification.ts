import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DispatchSelection } from '../gateway/contracts.ts';
import type { Id, Tx } from '../platform/contracts.ts';
import type {
  CertificationChallenge,
  CertificationEvidence,
  CertificationVerifier,
  ProbeContext,
} from './contracts.ts';
import { fail, hash, receiptExpiry, same } from './helpers.ts';
export const requiredCertificationSurfaces = [
  'init',
  'invocation',
  'native-read',
  'bash-script',
  'mcp',
  'child',
  'absolute',
  'symlink',
  'hardlink',
  'network',
] as const;
export const denyCertification: CertificationVerifier = { verify: async () => 'UNVERIFIED' };
export type ChallengeInput = {
  machineId: Id;
  projectId: Id;
  context: ProbeContext;
  maxTurns: number;
  maxTools: number;
  maxCostUsd: number;
};
/** Never supplied by production route composition. A scratch controller supplies explicit bound scope. */
export type ChallengeIssuer = { authorize(tx: Tx, input: ChallengeInput): Promise<void> };
export async function issueCertificationChallenge(
  tx: Tx,
  input: ChallengeInput,
  now = new Date(),
  issuer?: ChallengeIssuer,
): Promise<CertificationChallenge> {
  if (!issuer) fail('TEST_CERTIFICATION_NOT_CONFIGURED', 503);
  await issuer.authorize(tx, input);
  const [bound] =
    await tx`select p.machine_id,m.revoked_at from projects p join machines m on m.id=p.machine_id where p.id=${input.projectId}`;
  if (!bound || bound.machine_id !== input.machineId || bound.revoked_at) fail('CHALLENGE_SCOPE_INVALID');
  if (
    !Number.isSafeInteger(input.maxTurns) ||
    input.maxTurns < 1 ||
    input.maxTurns > 20 ||
    !Number.isSafeInteger(input.maxTools) ||
    input.maxTools < 1 ||
    input.maxTools > 100 ||
    !Number.isFinite(input.maxCostUsd) ||
    input.maxCostUsd < 0 ||
    input.maxCostUsd > 10
  )
    fail('CHALLENGE_BUDGET_INVALID', 400);
  const id = randomUUID(),
    nonce = randomBytes(32).toString('hex'),
    expiresAt = receiptExpiry(now).toISOString();
  await tx`insert into model_certification_challenges(id,machine_id,project_id,nonce_hash,context,expires_at,max_turns,max_tools,max_cost_usd,state,created_at) values(${id},${input.machineId},${input.projectId},${createHash('sha256').update(nonce).digest('hex')},${tx.json(input.context)},${expiresAt},${input.maxTurns},${input.maxTools},${input.maxCostUsd},'issued',${now})`;
  return {
    id,
    nonce,
    machineId: input.machineId,
    projectId: input.projectId,
    ...input.context,
    expiresAt,
    maxTurns: input.maxTurns,
    maxTools: input.maxTools,
    maxCostUsd: input.maxCostUsd,
  };
}
export async function verifyCertification(
  tx: Tx,
  evidence: CertificationEvidence,
  now = new Date(),
  verifier: CertificationVerifier = denyCertification,
  machineId?: Id,
): Promise<'PASS' | 'UNVERIFIED' | 'FAIL'> {
  const [challenge] =
    await tx`select * from model_certification_challenges where id=${evidence.challengeId} for update`;
  if (!challenge) return 'UNVERIFIED';
  if (machineId && challenge.machine_id !== machineId) fail('NOT_FOUND', 404);
  const [prior] =
    await tx`select * from runtime_certification_receipts where challenge_id=${evidence.challengeId}`;
  if (prior) {
    if (prior.body_hash !== hash(evidence)) fail('CERTIFICATION_REPORT_CONFLICT');
    return prior.status as 'PASS' | 'UNVERIFIED' | 'FAIL';
  }
  const [attempt] =
    await tx`select a.*,g.active_attempt_id,p.machine_id as bound_machine,p.binding_revision as current_binding from attempts a join execution_guards g on g.ticket_id=a.ticket_id join tickets t on t.id=a.ticket_id join projects p on p.id=t.project_id where a.id=${evidence.attemptId}`;
  if (
    !attempt ||
    challenge.state !== 'admitted' ||
    challenge.attempt_id !== evidence.attemptId ||
    challenge.machine_id !== attempt.machine_id ||
    challenge.admitted_command_id !== attempt.command_id ||
    String(challenge.admitted_fence) !== evidence.fence ||
    String(attempt.fence) !== evidence.fence ||
    challenge.process_instance_id !== evidence.processInstanceId ||
    attempt.process_instance_id !== evidence.processInstanceId ||
    attempt.active_attempt_id !== attempt.id ||
    !['active', 'uncertain'].includes(String(attempt.state)) ||
    attempt.bound_machine !== attempt.machine_id ||
    Number(attempt.current_binding) !== Number(attempt.binding_revision) ||
    (challenge.expires_at as Date).getTime() <= now.getTime() ||
    !same(challenge.context, evidence.context)
  )
    return 'UNVERIFIED';
  const [command] = await tx`select payload from commands where id=${challenge.admitted_command_id}`;
  const [decision] = await tx`select scope from decisions where id=${challenge.admitted_decision_id}`;
  const payload = command?.payload as { selection?: DispatchSelection } | undefined,
    scope = decision?.scope as { selection?: DispatchSelection } | undefined;
  const selection = payload?.selection;
  if (
    !selection ||
    !same(selection, scope?.selection) ||
    selection.sourceTreeSha256 !== evidence.context.sourceTreeSha256 ||
    selection.projectionManifestSha256 !== evidence.context.projectionManifestSha256 ||
    selection.projectionTreeSha256 !== evidence.context.projectionTreeSha256
  )
    return 'UNVERIFIED';
  const [companion] =
    await tx`select * from gateway_attempt_projections where attempt_id=${evidence.attemptId}`;
  if (
    !companion ||
    companion.runtime !== selection.runtime ||
    String(companion.fence) !== evidence.fence ||
    companion.process_instance_id !== evidence.processInstanceId
  )
    return 'UNVERIFIED';
  if (
    new Set(evidence.surfaceResults.map((s) => s.surface)).size !== evidence.surfaceResults.length ||
    !requiredCertificationSurfaces.every((surface) =>
      evidence.surfaceResults.some((s) => s.surface === surface && s.selectedWorked && s.unselectedDenied),
    )
  )
    return 'UNVERIFIED';
  if (evidence.artifactIds.length) {
    const artifacts =
      await tx`select id from evidence where attempt_id=${evidence.attemptId} and kind='artifact' and id=any(${tx.array(evidence.artifactIds)}::uuid[])`;
    if (artifacts.length !== evidence.artifactIds.length) return 'UNVERIFIED';
  }
  const c: CertificationChallenge = {
    id: String(challenge.id),
    nonce: '',
    machineId: String(challenge.machine_id),
    projectId: String(challenge.project_id),
    ...(challenge.context as ProbeContext),
    expiresAt: (challenge.expires_at as Date).toISOString(),
    maxTurns: Number(challenge.max_turns),
    maxTools: Number(challenge.max_tools),
    maxCostUsd: Number(challenge.max_cost_usd),
  };
  const status = await verifier.verify(tx, { evidence, challenge: c, selection });
  if (status === 'UNVERIFIED') return status;
  const ctx = evidence.context;
  await tx`insert into runtime_certification_receipts(id,challenge_id,attempt_id,machine_id,runtime,source_tree_sha256,projection_manifest_sha256,projection_tree_sha256,derivation_hash,binary_hash,policy_hash,os_version,evidence_digest,body_hash,status,received_at,expires_at) values(${randomUUID()},${challenge.id},${evidence.attemptId},${challenge.machine_id},${selection.runtime},${ctx.sourceTreeSha256},${ctx.projectionManifestSha256},${ctx.projectionTreeSha256},${ctx.derivationSha256},${ctx.binarySha256},${ctx.policySha256},${ctx.osVersion},${evidence.traceSha256},${hash(evidence)},${status},${now},${receiptExpiry(now)})`;
  await tx`update model_certification_challenges set state=${status === 'PASS' ? 'verified' : 'failed'} where id=${challenge.id}`;
  return status;
}
