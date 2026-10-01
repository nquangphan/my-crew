export type Status = 'pending' | 'ready' | 'running' | 'needs_input' | 'paused' | 'done' | 'cancelled';
export type Signal =
  | 'dependencies_ready'
  | 'start'
  | 'wait_owner'
  | 'pause_confirmed'
  | 'cancel_confirmed'
  | 'resume'
  | 'reconciled_stopped'
  | 'passed';

export function transition(status: Status, signal: Signal): Status {
  const edges: Partial<Record<Status, Partial<Record<Signal, Status>>>> = {
    pending: {
      dependencies_ready: 'ready',
      wait_owner: 'needs_input',
      pause_confirmed: 'paused',
      cancel_confirmed: 'cancelled',
    },
    ready: {
      start: 'running',
      wait_owner: 'needs_input',
      pause_confirmed: 'paused',
      cancel_confirmed: 'cancelled',
    },
    running: {
      wait_owner: 'needs_input',
      pause_confirmed: 'paused',
      cancel_confirmed: 'cancelled',
      reconciled_stopped: 'pending',
      passed: 'done',
    },
    needs_input: { resume: 'pending', cancel_confirmed: 'cancelled' },
    paused: { resume: 'pending', cancel_confirmed: 'cancelled' },
  };
  const statusEdges = Object.hasOwn(edges, status) ? edges[status] : undefined;
  const next = statusEdges && Object.hasOwn(statusEdges, signal) ? statusEdges[signal] : undefined;
  if (!next) throw new Error('INVALID_TICKET_TRANSITION');
  return next;
}

export function recordRepairFailure(completedCycles: number): {
  cycles: number;
  action: 'repair' | 'ask_owner';
} {
  if (!Number.isInteger(completedCycles) || completedCycles < 0 || completedCycles > 5)
    throw new Error('INVALID_REPAIR_COUNT');
  const cycles = Math.min(5, completedCycles + 1);
  return { cycles, action: cycles === 5 ? 'ask_owner' : 'repair' };
}
