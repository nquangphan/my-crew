import type { ClaimRequest, Machine, Notice, Project, ProjectChangeRequest, Ticket } from '@crew/shared';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api-client';
import {
  keys,
  useClaimRequests,
  useMachines,
  useNotices,
  useProjectChanges,
  useProjects,
  useTickets,
} from './queries';

export interface InboxSummary {
  pendingClaims: ClaimRequest[];
  /** Type and UI-test MCP changes machines asked for, waiting for the owner's TOTP. */
  pendingChanges: ProjectChangeRequest[];
  /** Tickets waiting for an owner answer; those with `budgetHold` wait for a cap or budget approval. */
  needsInput: Ticket[];
  offlineMachines: Machine[];
  unhealthyMachines: Machine[];
  unownedProjects: Project[];
  notices: Notice[];
  /** Unread notices in the whole history (server-side, shared by every device). */
  unreadNotices: number;
  /** Items that need an action plus unread notices: the bell badge. */
  badge: number;
  isLoading: boolean;
  /** Marks the given notices read. */
  markRead: (ids: string[]) => Promise<void>;
  /** Marks every notice read, up to `throughId` when given. */
  markAllRead: (throughId?: string) => Promise<void>;
}

/**
 * The owner's single "needs me" list. Action items come from current state (claims, project changes,
 * tickets, machines, projects), so they stay until resolved; machine and budget notices come from
 * `/v1/notices` with the read state the server keeps for the owner, so a phone and a desktop agree.
 */
export function useInboxSummary(): InboxSummary {
  const queryClient = useQueryClient();
  const claims = useClaimRequests('pending');
  const changes = useProjectChanges('pending');
  const needsInput = useTickets({ status: ['needs_input'] });
  const machines = useMachines();
  const projects = useProjects();
  const notices = useNotices();

  const live = (machines.data ?? []).filter((m) => m.revokedAt === null);
  const offlineMachines = live.filter((m) => !m.online);
  const unhealthyMachines = live.filter((m) => m.online && m.health?.status === 'red');
  const unownedProjects = (projects.data ?? []).filter((p) => p.ownerMachineId === null);
  const unreadNotices = notices.data?.unread ?? 0;
  const pendingClaims = claims.data ?? [];
  const pendingChanges = changes.data ?? [];
  const waiting = needsInput.data ?? [];
  const refreshNotices = () => queryClient.invalidateQueries({ queryKey: keys.notices });

  return {
    pendingClaims,
    pendingChanges,
    needsInput: waiting,
    offlineMachines,
    unhealthyMachines,
    unownedProjects,
    notices: notices.data?.items ?? [],
    unreadNotices,
    badge:
      pendingClaims.length +
      pendingChanges.length +
      waiting.length +
      offlineMachines.length +
      unhealthyMachines.length +
      unownedProjects.length +
      unreadNotices,
    isLoading:
      claims.isLoading ||
      changes.isLoading ||
      needsInput.isLoading ||
      machines.isLoading ||
      projects.isLoading,
    markRead: async (ids) => {
      if (ids.length === 0) return;
      await api.markNoticesRead(ids);
      await refreshNotices();
    },
    markAllRead: async (throughId) => {
      await api.markAllNoticesRead(throughId);
      await refreshNotices();
    },
  };
}
