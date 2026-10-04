import { arr, type Infer, int, lit, nullable, num, obj, page, str, uuid } from './http.ts';

const auditState = lit('unverified', 'invalid', 'verified');
const contentClass = lit('implemented', 'workflow_artifact');

/** `DocLink`, `v2/server/src/docs/contracts.ts:46`. */
export const decodeDocLink = obj({
  fromPath: str,
  occurrence: int,
  originalHref: str,
  toPath: str,
  fragment: nullable(str),
  status: lit('ok', 'missing', 'external', 'unverified'),
});

/** GET `/v2/projects/:id/docs/tree` — `DocsTree`, `v2/server/src/docs/read.ts:21`. */
export const decodeDocsTree = obj({
  projectId: uuid,
  snapshotId: uuid,
  sourceCommit: nullable(str),
  auditState,
  contentClass: lit('implemented', 'workflow_artifact', 'mixed'),
  pages: arr(obj({ path: str, title: str, parentPath: nullable(str), contentClass })),
  links: arr(decodeDocLink),
  relatedTicketIds: arr(uuid),
});
export type DocsTree = Infer<typeof decodeDocsTree>;

/** GET `/v2/projects/:id/docs/page` — `DocsPage`, `v2/server/src/docs/read.ts:9`. */
export const decodeDocsPage = obj({
  snapshotId: uuid,
  projectId: uuid,
  path: str,
  text: str,
  sha256: str,
  sourceCommit: nullable(str),
  auditState,
  contentClass,
  receivedAt: str,
  relatedTicketIds: arr(uuid),
});
export type DocsPage = Infer<typeof decodeDocsPage>;

/** Search hit `DocsHit`, `v2/server/src/docs/search.ts:8`. */
export const decodeDocsHit = obj({
  snapshotId: uuid,
  projectId: uuid,
  path: str,
  title: str,
  snippet: str,
  sha256: str,
  sourceCommit: nullable(str),
  auditState,
  contentClass,
  score: num,
  relatedTicketIds: arr(uuid),
});
export type DocsHit = Infer<typeof decodeDocsHit>;

/** GET `/v2/docs/search` — opaque base64url cursor, not a UUID (`search.ts:122-137`). */
export const decodeDocsSearchPage = page(decodeDocsHit, str);
export type DocsSearchPage = Infer<typeof decodeDocsSearchPage>;
