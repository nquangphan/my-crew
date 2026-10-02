import type { AttemptProjectionPin } from '../journal/process-journal.ts';
import type { ProjectionPin, SourcePin } from './pins.ts';

// Task 5 must bind authenticated 005 finalization to this exact local record before
// adding a release producer. A heartbeat/ack/boot/stopped status is insufficient.
// No method accepts a caller boolean or manufactures an acceptance receipt.
export type ProcessReferenceReleaseRequirement = {
  launchId: string;
  processInstanceId: string;
  authorization: AttemptProjectionPin | null;
  source: SourcePin;
  projection: ProjectionPin;
  requires: readonly [
    'authenticated-005-finalization-same-attempt-fence-process-and-pair',
    'actual-local-stop-proof',
    'no-other-retained-references',
  ];
};
export type RetentionInventory = {
  runId: string;
  authority: 'registry' | 'process-journal' | 'pin-admission';
  source: SourcePin;
  projection: ProjectionPin;
  sourceBytes: number | null;
  projectionBytes: number | null;
  reason:
    | 'durable-run-reference'
    | 'accepted-finalization-producer-unavailable'
    | 'durable-pin-admission-intent';
  releaseRequirement: ProcessReferenceReleaseRequirement | null;
};
