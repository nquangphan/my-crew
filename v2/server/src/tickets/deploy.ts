import { createHash } from 'node:crypto';
import { canonicalJson } from '../journal/canonical.ts';
import type { Id, Tx } from '../platform/contracts.ts';
import type { CreateTicket } from './contracts.ts';

export type DeployAuthorization = 'owner_deploy_request' | 'owner_approval';

export function deployTicketFingerprint(input: CreateTicket, rootId: Id): string {
  const { deployApprovalDecisionId: _approvalId, ...definition } = input;
  return createHash('sha256')
    .update(
      canonicalJson({
        action: 'deploy',
        rootId,
        definition,
      }),
    )
    .digest('hex');
}

export async function verifyDeployApprovalForCandidate(
  tx: Tx,
  rootId: Id,
  decisionId: Id,
  fingerprint: string,
): Promise<boolean> {
  const [approval] = await tx`select id from decisions where id=${decisionId} and ticket_id=${rootId}
    and actor_kind='owner' and kind='approval' and scope @>
      ${tx.json({ action: 'deploy', rootTicketId: rootId, ticketDefinitionHash: fingerprint })}::jsonb`;
  if (!approval) return false;
  const [used] = await tx`select id from tickets where deploy_approval_decision_id=${decisionId} limit 1`;
  return !used;
}

export async function readDeployAuthorization(tx: Tx, ticketId: Id): Promise<DeployAuthorization | null> {
  const [row] = await tx`select id,kind,level,root_id,created_actor_kind,
      deploy_definition_hash,deploy_approval_decision_id from tickets where id=${ticketId}`;
  if (row?.kind !== 'deploy') return null;
  if (row.level === 'request' && row.id === row.root_id && row.created_actor_kind === 'owner')
    return 'owner_deploy_request';
  if (row.deploy_approval_decision_id) {
    const [approval] = await tx`select id from decisions where id=${row.deploy_approval_decision_id}
      and ticket_id=${row.root_id} and actor_kind='owner' and kind='approval' and scope @>
        ${tx.json({
          action: 'deploy',
          rootTicketId: row.root_id,
          ticketDefinitionHash: row.deploy_definition_hash,
        })}::jsonb`;
    if (approval) return 'owner_approval';
  }
  const [direct] = await tx`select id from decisions where ticket_id=${ticketId}
    and actor_kind='owner' and kind='approval' and scope @>
      ${tx.json({
        action: 'deploy',
        targetTicketId: ticketId,
        ticketDefinitionHash: row.deploy_definition_hash,
      })}::jsonb limit 1`;
  return direct ? 'owner_approval' : null;
}
