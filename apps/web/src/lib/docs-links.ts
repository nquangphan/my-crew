/**
 * Links into the project docs space. The docs viewer itself is built in the docs phase; everything that
 * links to docs (ticket "Docs liên quan" chips, quick search results, the sidebar and `g d`) goes through
 * these helpers, so the viewer only has to honour this URL shape:
 *
 *   /projects/$projectKey/docs            the space home
 *   /projects/$projectKey/docs?flow=<id>  the page of one flow in docs/flows.yaml
 *   /projects/$projectKey/docs?path=<p>   a page by its repo path (search results)
 */
export interface DocsLink {
  to: '/projects/$projectKey/docs';
  params: { projectKey: string };
  search: { flow?: string; path?: string };
}

export function docsHome(projectKey: string): DocsLink {
  return { to: '/projects/$projectKey/docs', params: { projectKey }, search: {} };
}

export function docsFlow(projectKey: string, flow: string): DocsLink {
  return { to: '/projects/$projectKey/docs', params: { projectKey }, search: { flow } };
}

export function docsPage(projectKey: string, path: string): DocsLink {
  return { to: '/projects/$projectKey/docs', params: { projectKey }, search: { path } };
}
