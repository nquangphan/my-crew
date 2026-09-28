import { TicketView } from '../components/ticket-view';
import { Breadcrumbs, type Crumb } from '../layout/breadcrumbs';
import { useProjects, useTicket } from '../lib/queries';

/** Full-page ticket: same component as the side panel, in the two-column Jira layout. */
export function TicketDetailPage({ ticketKey }: { ticketKey: string }) {
  const detail = useTicket(ticketKey);
  const parent = useTicket(detail.data?.ticket.parentId);
  const projects = useProjects();
  const ticket = detail.data?.ticket;
  const project = projects.data?.find((p) => p.id === ticket?.projectId);

  const crumbs: Crumb[] = [{ label: 'Dự án', link: { to: '/projects' } }];
  if (project) {
    crumbs.push({
      label: project.name,
      link: { to: '/projects/$projectKey/board', params: { projectKey: project.key } },
    });
  } else {
    crumbs.push({ label: 'Request', link: { to: '/requests' } });
  }
  if (parent.data) {
    crumbs.push({
      label: parent.data.ticket.key,
      mono: true,
      link: { to: '/tickets/$ticketKey', params: { ticketKey: parent.data.ticket.key } },
    });
  }
  crumbs.push({ label: ticket?.key ?? ticketKey.toUpperCase(), mono: true });

  return (
    <div className="flex flex-col gap-3.5 px-3 pt-3 md:px-6 md:pt-[18px]">
      <Breadcrumbs items={crumbs} />
      <TicketView ticketKey={ticketKey} mode="page" />
      <div className="h-6 shrink-0" />
    </div>
  );
}
