import type { Comment, Report, Ticket, TicketDetailResponse } from '@crew/shared';

const OPEN = '<untrusted-data';
const CLOSE = '</untrusted-data>';

/**
 * Wraps text the owner did not write (agent-written descriptions, comments and reports, repo text, hook
 * output) so the agent treats it as data, never as instructions. A delimiter inside the text is defused, so
 * the text cannot close the block early and smuggle instructions after it.
 */
export function wrapUntrusted(source: string, text: string): string {
  const safeSource = source.replace(/[^A-Za-z0-9 _./:#-]/g, '_').slice(0, 120);
  const body = text.replace(/<\/?untrusted-data/gi, (match) => match.replace('<', '‹'));
  return `${OPEN} source="${safeSource}">\n${body}\n${CLOSE}`;
}

/** Owner-written text: request tickets (created on the web) and the owner's own comments. */
export function ownerWroteTicketText(ticket: Pick<Ticket, 'type'>): boolean {
  return ticket.type === 'request';
}

function wrapTicket(ticket: Ticket): Ticket {
  if (ownerWroteTicketText(ticket)) return ticket;
  return {
    ...ticket,
    title: wrapUntrusted(`ticket ${ticket.key} title`, ticket.title),
    description: wrapUntrusted(`ticket ${ticket.key} description`, ticket.description),
  };
}

function wrapComment(comment: Comment): Comment {
  if (comment.authorKind === 'owner') return comment;
  const author = comment.authorRole ? `${comment.authorKind}/${comment.authorRole}` : comment.authorKind;
  return { ...comment, body: wrapUntrusted(`comment by ${author}`, comment.body) };
}

function wrapReport(report: Report | null, key: string): Report | null {
  if (!report) return null;
  return {
    ...report,
    summaryMd: wrapUntrusted(`report of ${key}`, report.summaryMd),
    testsRun: report.testsRun.map((test) =>
      test.summary === undefined
        ? test
        : { ...test, summary: wrapUntrusted(`test ${test.name}`, test.summary) },
    ),
  };
}

/** A ticket detail as an agent sees it: every text the owner did not write is wrapped. */
export function wrapTicketDetail(detail: TicketDetailResponse): TicketDetailResponse {
  return {
    ...detail,
    ticket: wrapTicket(detail.ticket),
    children: detail.children.map(wrapTicket),
    comments: detail.comments.map(wrapComment),
    report: wrapReport(detail.report, detail.ticket.key),
  };
}
