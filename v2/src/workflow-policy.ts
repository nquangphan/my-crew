export type Workflow = 'bmad' | 'superpowers';
export type Pin = { workflow: Workflow; version: string; revision: string; checksum: string };
export function samePin(a: Pin, b: Pin): boolean {
  return (
    a.workflow === b.workflow &&
    a.version === b.version &&
    a.revision === b.revision &&
    a.checksum === b.checksum
  );
}
export function workflowsReady(required: Pin[], installed: Pin[]): boolean {
  return (['bmad', 'superpowers'] as Workflow[]).every((name) => {
    const targets = required.filter((p) => p.workflow === name);
    const target = targets[0];
    return targets.length === 1 && target !== undefined && installed.some((p) => samePin(p, target));
  });
}
export function assertSkillAllowed(run: Pin, origin: Pin): void {
  if (!samePin(run, origin)) throw new Error('WORKFLOW_SOURCE_MISMATCH');
}
