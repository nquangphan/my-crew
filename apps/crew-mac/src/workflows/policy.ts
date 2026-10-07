import type { WorkflowPin } from './pin.js';

export function samePin(a: WorkflowPin, b: WorkflowPin): boolean {
  return (
    a.workflow === b.workflow &&
    a.version === b.version &&
    a.revision === b.revision &&
    a.checksum === b.checksum
  );
}

/** Ném `WORKFLOW_SOURCE_MISMATCH` khi bản workflow mà run sẽ nạp (`origin`) khác bản ghim (`run`). */
export function assertSkillAllowed(run: WorkflowPin, origin: WorkflowPin): void {
  if (!samePin(run, origin)) throw new Error('WORKFLOW_SOURCE_MISMATCH');
}
