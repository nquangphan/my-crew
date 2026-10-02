import { canComplete, canDeploy } from '../../../src/completion-policy.ts';
import type { Tx } from '../platform/contracts.ts';
import type { DocsCompletionReader, Ticket } from './contracts.ts';

const noDocs: DocsCompletionReader = async () => null;

export async function readCompletionFacts(
  tx: Tx,
  ticket: Ticket,
  docsReader: DocsCompletionReader = noDocs,
): Promise<{
  ready: boolean;
  mandatoryStepsPassed: boolean;
  evidenceReady: boolean;
  mergedCommit: string | null;
  docsCommit: string | null;
}> {
  const [incomplete] = await tx`with recursive descendants(id) as (
    select id from tickets where parent_id=${ticket.id}
    union all select t.id from tickets t join descendants d on t.parent_id=d.id
  ) select 1 from tickets t join descendants d on d.id=t.id
    where t.mandatory and t.status<>'done' limit 1`;
  const mandatoryStepsPassed = !incomplete;
  const evidence =
    await tx`select kind,data from evidence where ticket_id=${ticket.id} order by created_at,id`;
  const verified = evidence.filter((row) => row.data?.verification === 'verified');
  const neededKind =
    ticket.kind === 'code'
      ? 'code_result'
      : ticket.kind === 'docs'
        ? 'docs_result'
        : ticket.kind === 'deploy'
          ? 'deploy_result'
          : 'research_result';
  const required = ticket.criteria.requiredEvidenceKinds;
  const validRequired =
    required === undefined ||
    (Array.isArray(required) &&
      required.length <= 100 &&
      required.every((kind) => typeof kind === 'string' && kind.length > 0 && kind.length <= 100));
  const evidenceReady =
    validRequired &&
    verified.some((row) => row.kind === neededKind) &&
    (required === undefined ||
      (required as string[]).every((kind) => verified.some((row) => row.kind === kind)));
  const merge = verified.find(
    (row) =>
      row.kind === 'merge' &&
      typeof row.data?.commit === 'string' &&
      /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(row.data.commit),
  );
  const mergedCommit = merge ? (merge.data.commit as string) : null;
  const docsCommit = ticket.level === 'request' ? await docsReader(tx, ticket.projectId, mergedCommit) : null;
  let ready = false;
  if (ticket.level !== 'request') {
    ready = mandatoryStepsPassed && evidenceReady;
  } else if (ticket.kind === 'deploy') {
    const [approved] = await tx`select id from decisions where ticket_id=${ticket.id} and kind='approval'
      and actor_kind='owner' and scope @> ${tx.json({ action: 'deploy' })}::jsonb limit 1`;
    ready =
      mandatoryStepsPassed &&
      evidenceReady &&
      canDeploy({ hasDeployTicket: ticket.level === 'request', ownerApproved: !!approved });
  } else {
    ready = canComplete({ kind: ticket.kind, mandatoryStepsPassed, evidenceReady, mergedCommit, docsCommit });
  }
  return { ready, mandatoryStepsPassed, evidenceReady, mergedCommit, docsCommit };
}
