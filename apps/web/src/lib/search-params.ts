import type { AgentRole, TicketPriority, TicketStatus, TicketType } from '@crew/shared';
import {
  TicketPriority as PrioritySchema,
  ProjectKey as ProjectKeySchema,
  AgentRole as RoleSchema,
  TicketStatus as StatusSchema,
  TicketType as TypeSchema,
} from '@crew/shared';
import { z } from 'zod';

/** Parses search params with a schema; anything invalid falls back to the defaults instead of throwing. */
export function searchOf<S extends z.ZodObject>(schema: S) {
  return (search: Record<string, unknown>): z.output<S> => {
    const parsed = schema.safeParse(search);
    return parsed.success ? parsed.data : schema.parse({});
  };
}

/** Comma-separated filter values keep bookmarked URLs short and readable. */
const Csv = z.string().max(300).optional().catch(undefined);
const Opt = z.string().max(100).optional().catch(undefined);

export const BoardSearch = z.object({
  type: Csv,
  role: Csv,
  priority: Csv,
  /** Only the tickets that wait for the owner (needs_input, blocked, or a budget hold). */
  mine: z.boolean().optional().catch(undefined),
  /**
   * Swimlanes. A project board groups by parent (the pm_task) by default; the all-projects board by
   * request → pm_task (`request`) or by project.
   */
  group: z.enum(['parent', 'request', 'project', 'none']).optional().catch(undefined),
  /** Key of the ticket open in the side panel. */
  selected: Opt,
});
export type BoardSearch = z.infer<typeof BoardSearch>;

/** The all-projects board: the project board's filters plus projects (keys, comma-separated). */
export const AllBoardSearch = BoardSearch.extend({ project: Csv });
export type AllBoardSearch = z.infer<typeof AllBoardSearch>;

export const LIST_SORTS = [
  'key',
  'project',
  'type',
  'title',
  'status',
  'role',
  'priority',
  'model',
  'cost',
  'updatedAt',
] as const;
export type ListSort = (typeof LIST_SORTS)[number];

export const ListSearch = z.object({
  status: Csv,
  type: Csv,
  role: Csv,
  priority: Csv,
  q: Opt,
  sort: z.enum(LIST_SORTS).optional().catch(undefined),
  order: z.enum(['asc', 'desc']).optional().catch(undefined),
});
export type ListSearch = z.infer<typeof ListSearch>;

/** The all-projects list: the project list's filters plus projects (keys, comma-separated). */
export const AllListSearch = ListSearch.extend({ project: Csv });
export type AllListSearch = z.infer<typeof AllListSearch>;

export const DocsSearch = z.object({
  flow: Opt,
  path: z.string().max(1000).optional().catch(undefined),
});
export type DocsSearch = z.infer<typeof DocsSearch>;

export const LoginSearch = z.object({ redirect: z.string().max(2000).optional().catch(undefined) });

function csv<T extends string>(value: string | undefined, schema: z.ZodType<T>): T[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is T => schema.safeParse(part).success);
}

export const parseTypes = (value: string | undefined): TicketType[] => csv(value, TypeSchema);
export const parseRoles = (value: string | undefined): AgentRole[] => csv(value, RoleSchema);
export const parsePriorities = (value: string | undefined): TicketPriority[] => csv(value, PrioritySchema);
export const parseStatuses = (value: string | undefined): TicketStatus[] => csv(value, StatusSchema);
export const parseProjectKeys = (value: string | undefined): string[] => csv(value, ProjectKeySchema);

/** Toggles one value in a CSV filter; an empty result removes the parameter. */
export function toggleCsv(value: string | undefined, item: string): string | undefined {
  const parts = new Set(value ? value.split(',').filter(Boolean) : []);
  if (parts.has(item)) parts.delete(item);
  else parts.add(item);
  return parts.size > 0 ? [...parts].join(',') : undefined;
}

/**
 * A redirect target is only followed when it is a path on this site, so a crafted login link cannot send the
 * owner elsewhere.
 */
export function safeRedirect(target: string | undefined): string {
  if (!target?.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) return '/';
  if (target.startsWith('/login')) return '/';
  return target;
}
