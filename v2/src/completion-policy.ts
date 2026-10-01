export type Completion = {
  kind: 'code' | 'research' | 'docs';
  mandatoryStepsPassed: boolean;
  evidenceReady: boolean;
  mergedCommit: string | null;
  docsCommit: string | null;
};

export function canComplete(input: Completion): boolean {
  if (!input.mandatoryStepsPassed || !input.evidenceReady) return false;
  if (input.kind === 'code') return Boolean(input.mergedCommit) && input.docsCommit === input.mergedCommit;
  if (input.kind === 'docs') return Boolean(input.docsCommit);
  return true;
}

export function canDeploy(input: { hasDeployTicket: boolean; ownerApproved: boolean }): boolean {
  return input.hasDeployTicket || input.ownerApproved;
}
