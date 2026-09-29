import type { Comment, Ticket, TicketDetailResponse } from '@crew/shared';

let seq = 0;
const uuid = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
};

export function ticket(overrides: Partial<Ticket> = {}): Ticket {
  const now = '2026-09-28T02:00:00.000Z';
  return {
    id: uuid(),
    key: 'SHOP-1',
    title: 'Ticket',
    description: '',
    type: 'dev',
    parentId: null,
    projectId: null,
    projectHintId: null,
    assigneeRole: 'dev',
    assigneeMachineId: null,
    status: 'todo',
    priority: 'medium',
    allowConfigChange: false,
    complexity: null,
    complexityReason: null,
    model: null,
    effort: null,
    requiredSkills: [],
    requiredMcps: [],
    dependsOn: [],
    pairsWith: null,
    originDevId: null,
    bugCycle: 0,
    flows: [],
    agentSessionId: null,
    agentModel: null,
    agentEffort: null,
    costUsd: 0,
    budgetHold: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: uuid(),
    ticketId: uuid(),
    authorKind: 'agent',
    authorRole: 'pm',
    body: 'Câu hỏi',
    mentions: [],
    createdAt: '2026-09-28T02:00:00.000Z',
    ...overrides,
  };
}

export function detail(t: Ticket, overrides: Partial<TicketDetailResponse> = {}): TicketDetailResponse {
  return { ticket: t, children: [], comments: [], report: null, events: [], ...overrides };
}
