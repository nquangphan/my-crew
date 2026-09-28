import type { ClaimRequest, EventEnvelope, Machine, Project, Ticket } from '@crew/shared';
import { useClaimRequests, useMachines, useNotices, useProjects, useTickets } from './queries';
import { useStoredState } from './ui-state';

const LAST_READ_KEY = 'crew.inbox.lastReadSeq';

export interface InboxSummary {
  pendingClaims: ClaimRequest[];
  /** Tickets waiting for an owner answer; those with `budgetHold` wait for a cap or budget approval. */
  needsInput: Ticket[];
  offlineMachines: Machine[];
  unhealthyMachines: Machine[];
  unownedProjects: Project[];
  notices: EventEnvelope[];
  unreadNotices: number;
  /** Items that need an action plus unread notices: the bell badge. */
  badge: number;
  isLoading: boolean;
  markRead: () => void;
}

/** Newest notice sequence, compared numerically (sequences are decimal strings). */
function maxSeq(events: readonly EventEnvelope[]): string | null {
  let best: bigint | null = null;
  for (const event of events) {
    const seq = BigInt(event.id);
    if (best === null || seq > best) best = seq;
  }
  return best === null ? null : best.toString();
}

/**
 * The owner's single "needs me" list. Action items come from current state (claims, tickets, machines,
 * projects), so they stay until resolved; machine and budget notices come from `/v1/notices` and count
 * as unread until the inbox is opened. The read marker is kept per browser.
 */
export function useInboxSummary(): InboxSummary {
  const claims = useClaimRequests('pending');
  const needsInput = useTickets({ status: ['needs_input'] });
  const machines = useMachines();
  const projects = useProjects();
  const notices = useNotices();
  const [lastRead, setLastRead] = useStoredState<string | null>(LAST_READ_KEY, null);

  const live = (machines.data ?? []).filter((m) => m.revokedAt === null);
  const offlineMachines = live.filter((m) => !m.online);
  const unhealthyMachines = live.filter((m) => m.online && m.health?.status === 'red');
  const unownedProjects = (projects.data ?? []).filter((p) => p.ownerMachineId === null);
  const noticeList = notices.data ?? [];
  const unreadNotices = noticeList.filter(
    (event) => lastRead === null || BigInt(event.id) > BigInt(lastRead),
  ).length;
  const pendingClaims = claims.data ?? [];
  const waiting = needsInput.data ?? [];

  return {
    pendingClaims,
    needsInput: waiting,
    offlineMachines,
    unhealthyMachines,
    unownedProjects,
    notices: noticeList,
    unreadNotices,
    badge:
      pendingClaims.length +
      waiting.length +
      offlineMachines.length +
      unhealthyMachines.length +
      unownedProjects.length +
      unreadNotices,
    isLoading: claims.isLoading || needsInput.isLoading || machines.isLoading || projects.isLoading,
    markRead: () => {
      const newest = maxSeq(noticeList);
      if (newest && newest !== lastRead) setLastRead(newest);
    },
  };
}
