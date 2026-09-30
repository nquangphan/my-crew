import type { AgentActivity, EventEnvelope } from '@crew/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { invalidationsFor } from '../lib/live-events';
import { keys } from '../lib/queries';
import { ticket } from '../test/fixtures';
import { AgentActivityLine, AgentActivityMark, describeActivity } from './agent-activity';

// 11:40 in Asia/Saigon.
const NOW = Date.parse('2026-09-29T04:40:00.000Z');
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

function activity(overrides: Partial<AgentActivity>): AgentActivity {
  return {
    status: 'running',
    machineId: 'm1',
    machineName: 'Macbook-M4',
    machineOnline: true,
    role: 'assistant',
    stage: null,
    since: null,
    model: null,
    effort: null,
    waitReason: null,
    waitDetail: null,
    reportedAt: at(0.5),
    ...overrides,
  };
}

const text = (a: AgentActivity, type: 'request' | 'dev' = 'request') =>
  describeActivity(ticket({ type, agentActivity: a }), NOW)?.text;

describe('agent activity text', () => {
  it('says where and how an agent runs, and since when', () => {
    expect(text(activity({ since: at(8), model: 'sonnet', effort: 'high' }))).toBe(
      'Đang chạy trên Macbook-M4 · sonnet/high · từ 11:32',
    );
    // The server settings revision the run started with (prompts, rules, model map).
    expect(text(activity({ since: at(8), model: 'sonnet', settingsRevision: '3f9a1c2b' }))).toBe(
      'Đang chạy trên Macbook-M4 · sonnet · cài đặt 3f9a1c2b · từ 11:32',
    );
  });

  it('explains every wait reason', () => {
    expect(
      text(
        activity({
          status: 'queued',
          waitReason: 'no_slots',
          waitDetail: { loadAvg1: 22.04, cpus: 12, maxLoad: 18, slots: 0, runningJobs: 0 },
        }),
      ),
    ).toBe('Macbook-M4 đã nhận, đang chờ slot — máy bận (tải 22/18, 0 slot trống)');
    expect(
      text(activity({ status: 'queued', waitReason: 'no_slots', waitDetail: { slots: 2, runningJobs: 2 } })),
    ).toBe('Macbook-M4 đã nhận, đang chờ slot — máy bận (đã chạy đủ 2/2 job)');
    expect(
      text(activity({ status: 'queued', waitReason: 'waiting_deps', waitDetail: { dependsOn: ['AST-3'] } })),
    ).toBe('Chờ AST-3 xong');
    expect(
      text(activity({ status: 'backoff', waitReason: 'retry_at', waitDetail: { retryAt: at(-5) } })),
    ).toBe('Chờ thử lại lúc 11:45');
    expect(text(activity({ status: 'queued', waitReason: 'paused' }))).toBe(
      'Macbook-M4 đã nhận, máy đang tạm dừng, chờ bạn bật lại',
    );
    expect(
      text(activity({ status: 'queued', waitReason: 'no_local_folder', waitDetail: { projectKey: 'WEB' } })),
    ).toBe('Macbook-M4 đã nhận, máy chưa có thư mục dự án WEB');
    expect(text(activity({ status: 'queued' }))).toBe('Macbook-M4 đã nhận, đang xếp hàng');
  });

  it('shows a crash, an unreported ticket, and a silent machine as unknown rather than running', () => {
    expect(text(activity({ status: 'failed', waitDetail: { message: 'Error ENOENT: no such file' } }))).toBe(
      'Lỗi khi chạy trên Macbook-M4: Error ENOENT: no such file',
    );
    expect(text(activity({ status: 'unreported', machineOnline: false }))).toBe(
      'Chưa máy nào nhận (máy trợ lý Macbook-M4 offline)',
    );
    expect(text(activity({ status: 'unreported', machineName: null }), 'dev')).toBe(
      'Chưa máy nào nhận (chưa có máy dự án)',
    );
    expect(text(activity({ reportedAt: at(3) }))).toBe(
      'Không rõ — Macbook-M4 mất liên lạc (báo lần cuối 3 phút trước)',
    );
    expect(describeActivity(ticket({ agentActivity: null }), NOW)).toBeNull();
  });

  it('renders the ticket line and a card mark only while not running', () => {
    const waiting = ticket({
      agentActivity: activity({ status: 'queued', reportedAt: new Date().toISOString() }),
    });
    render(
      <>
        <AgentActivityLine ticket={waiting} />
        <AgentActivityMark ticket={waiting} />
      </>,
    );
    expect(screen.getByRole('status', { name: 'Hoạt động của agent' })).toHaveTextContent(
      'Macbook-M4 đã nhận, đang xếp hàng',
    );
    expect(screen.getByRole('img', { name: 'Macbook-M4 đã nhận, đang xếp hàng' })).toBeInTheDocument();
  });

  it('refetches tickets and machines when a machine reports new activity', () => {
    const event = {
      id: '9',
      type: 'agent.activity_changed',
      ticketId: null,
      projectId: null,
      targetMachineId: null,
      targetRole: null,
      payload: { type: 'agent.activity_changed', data: { machineId: 'm1', ticketIds: ['t1'] } },
      createdAt: new Date(NOW).toISOString(),
    } satisfies EventEnvelope;
    expect(invalidationsFor(event)).toEqual(
      expect.arrayContaining([keys.tickets, ['ticket'], keys.machines]),
    );
  });
});
