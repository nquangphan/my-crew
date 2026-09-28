import { Navigate } from '@tanstack/react-router';
import { useCurrentProjectKey } from '../layout/project-sidebar';
import { useProjects } from '../lib/queries';

/** `/` opens the current project's board, or the requests board when there is no project yet. */
export function HomeRedirect() {
  const projects = useProjects();
  const projectKey = useCurrentProjectKey();
  if (projects.isLoading) return <p className="m-0 p-6 text-sm text-muted">Đang tải…</p>;
  if (projectKey) return <Navigate to="/projects/$projectKey/board" params={{ projectKey }} replace />;
  return <Navigate to="/requests" replace />;
}
