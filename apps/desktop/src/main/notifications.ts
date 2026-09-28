import type { HealthReport, HealthStatus } from '@crew/shared';

export type ShowNotification = (title: string, body: string) => void;

export interface BlockedJob {
  ticketId: string;
  ticketKey: string | null;
  error: string | null;
}

/** macOS notifications: when health turns red, and when a job goes to `blocked`. */
export class Notifier {
  private lastStatus: HealthStatus | null = null;

  constructor(private readonly show: ShowNotification) {}

  onHealth(report: HealthReport): void {
    const status = report.summary.status;
    if (status === 'red' && this.lastStatus !== 'red') {
      const failing = report.results.filter((item) => item.status === 'red').map((item) => item.title);
      this.show(
        '2P Crew: sức khỏe máy chuyển đỏ',
        failing.slice(0, 3).join(', ') || 'Mở bảng sức khỏe để xem.',
      );
    }
    this.lastStatus = status;
  }

  onJobBlocked(job: BlockedJob): void {
    const ticket = job.ticketKey ?? job.ticketId;
    this.show(
      `2P Crew: ${ticket} bị chặn`,
      job.error ?? 'Job chuyển sang blocked: mở ticket trên web để xem.',
    );
  }
}
