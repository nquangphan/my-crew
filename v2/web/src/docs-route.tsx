/**
 * Route view for a project's docs space: the path lives in the URL (`?path=`), so a page can be linked and
 * survives reload; tickets linked from a page open in the shared ticket dialog.
 */
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { parseDocsSearch, routeUuid } from './app-runtime.ts';
import { DocsSpace } from './docs/space.tsx';
import { NotFoundView, useTicketDialog } from './ticket-routes.tsx';

export function ProjectDocsPage() {
  const params = useParams({ strict: false }) as { projectId?: string };
  const projectId = routeUuid(params.projectId);
  const { path } = parseDocsSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const navigate = useNavigate();
  const { openTicket, dialog } = useTicketDialog();
  if (!projectId) return <NotFoundView what="dự án" />;
  return (
    <>
      <DocsSpace
        projectId={projectId}
        path={path ?? null}
        onPathChange={(next) =>
          void navigate({
            to: '/projects/$projectId/docs',
            params: { projectId },
            search: next === null ? {} : { path: next },
          })
        }
        onOpenTicket={openTicket}
      />
      {dialog}
    </>
  );
}
