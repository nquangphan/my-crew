/**
 * Links into the project docs space. Everything that links to docs (ticket "Docs liên quan" chips, quick
 * search results, the sidebar, `g d` and the space itself) goes through these helpers, so the viewer
 * (`routes/project-docs.tsx`) only has to honour this URL shape:
 *
 *   /docs                                 the docs home (every project, cross-project search)
 *   /projects/$projectKey/docs            the space home
 *   /projects/$projectKey/docs?flow=<id>  the page of one flow in docs/flows.yaml
 *   /projects/$projectKey/docs?path=<p>   a page by its repo path (search results)
 */
export interface DocsLink {
  to: '/projects/$projectKey/docs';
  params: { projectKey: string };
  search: { flow?: string; path?: string };
}

/** The docs home: every project's docs status and a search across projects. */
export const DOCS_INDEX = { to: '/docs', search: {} } as const;

export function docsHome(projectKey: string): DocsLink {
  return { to: '/projects/$projectKey/docs', params: { projectKey }, search: {} };
}

export function docsFlow(projectKey: string, flow: string): DocsLink {
  return { to: '/projects/$projectKey/docs', params: { projectKey }, search: { flow } };
}

export function docsPage(projectKey: string, path: string): DocsLink {
  return { to: '/projects/$projectKey/docs', params: { projectKey }, search: { path } };
}

/** Link to a page of the space: flow pages by flow id (the URL tickets use), every other page by path. */
export function docsLinkFor(projectKey: string, page: { path: string; flowId: string | null }): DocsLink {
  return page.flowId ? docsFlow(projectKey, page.flowId) : docsPage(projectKey, page.path);
}
