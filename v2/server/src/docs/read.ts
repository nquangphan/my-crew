import { posix } from 'node:path';
import type { Actor, Db, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type { DocsCompletionReader, DocsSourceReader } from '../tickets/contracts.ts';
import type { ContentClass, DocLink } from './contracts.ts';
import { parseManifest, validPath } from './manifest.ts';

export type AuditState = 'unverified' | 'invalid' | 'verified';
export type DocsPage = {
  snapshotId: Id;
  projectId: Id;
  path: string;
  text: string;
  sha256: string;
  sourceCommit: string | null;
  auditState: AuditState;
  contentClass: ContentClass;
  receivedAt: string;
  relatedTicketIds: Id[];
};
export type DocsTree = {
  projectId: Id;
  snapshotId: Id;
  sourceCommit: string | null;
  auditState: AuditState;
  contentClass: ContentClass | 'mixed';
  pages: { path: string; title: string; parentPath: string | null; contentClass: ContentClass }[];
  links: DocLink[];
  relatedTicketIds: Id[];
};
export async function requireDocsScope(tx: Tx, projectId: Id, actor: Actor): Promise<void> {
  const [row] =
    await tx`select p.id from projects p where p.id=${projectId} and (${actor.kind === 'owner'} or (p.machine_id=${actor.kind === 'machine' ? actor.id : null}::uuid and exists(select 1 from machines m where m.id=p.machine_id and m.revoked_at is null)))`;
  if (!row) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy dự án');
}
export async function selectSnapshot(tx: Tx, projectId: Id, snapshotId: Id | null, actor: Actor) {
  await requireDocsScope(tx, projectId, actor);
  const [snapshot] =
    await tx`select * from docs_snapshots where project_id=${projectId} and (${snapshotId}::uuid is null or id=${snapshotId}) order by received_at desc,id desc limit 1`;
  if (!snapshot) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy tài liệu');
  return snapshot;
}
async function relatedTickets(tx: Tx, projectId: Id, snapshotId: Id, path: string | null): Promise<Id[]> {
  const rows =
    await tx`select distinct t.id from ticket_docs d join tickets t on t.id=d.ticket_id where t.project_id=${projectId} and d.snapshot_id=${snapshotId} and (${path}::text is null or d.path=${path}) order by t.id limit 20`;
  return rows.map((row) => row.id as Id);
}
export async function readDocsTree(
  db: Db,
  projectId: Id,
  snapshotId: Id | null,
  actor: Actor,
): Promise<DocsTree> {
  return db.begin('isolation level repeatable read read only', async (tx) => {
    const snapshot = await selectSnapshot(tx, projectId, snapshotId, actor);
    const rows =
      await tx`select path,title,content_class from docs_files where snapshot_id=${snapshot.id} order by path`;
    const paths = new Set(rows.map((row) => row.path as string));
    const pages = rows.map((row) => {
      const path = row.path as string;
      let dir = posix.dirname(path);
      let parentPath: string | null = null;
      while (dir !== '.') {
        const index = `${dir}/index.md`;
        if (index !== path && paths.has(index)) {
          parentPath = index;
          break;
        }
        if (paths.has(dir)) {
          parentPath = dir;
          break;
        }
        dir = posix.dirname(dir);
      }
      return {
        path,
        title: row.title as string,
        parentPath,
        contentClass: row.content_class as ContentClass,
      };
    });
    const links = (
      await tx`select * from docs_links where snapshot_id=${snapshot.id} order by from_path,occurrence`
    ).map((row) => ({
      fromPath: row.from_path as string,
      occurrence: Number(row.occurrence),
      originalHref: row.original_href as string,
      toPath: row.to_path as string,
      fragment: row.fragment as string | null,
      status: row.status as DocLink['status'],
    }));
    return {
      projectId,
      snapshotId: snapshot.id as Id,
      sourceCommit: snapshot.source_commit as string | null,
      auditState: snapshot.audit_state as AuditState,
      contentClass: snapshot.content_class as DocsTree['contentClass'],
      pages,
      links,
      relatedTicketIds: await relatedTickets(tx, projectId, snapshot.id as Id, null),
    };
  });
}
export async function readDocsPage(
  db: Db,
  projectId: Id,
  path: string,
  snapshotId: Id | null,
  actor: Actor,
): Promise<DocsPage> {
  if (!validPath(path)) throw new ApiError('PATH_INVALID', 400, 'Đường dẫn không hợp lệ');
  return db.begin('isolation level repeatable read read only', async (tx) => {
    const snapshot = await selectSnapshot(tx, projectId, snapshotId, actor);
    const [file] =
      await tx`select bytes,sha,content_class from docs_files where snapshot_id=${snapshot.id} and path=${path}`;
    if (!file) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy trang tài liệu');
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.bytes as Buffer);
    } catch {
      throw new ApiError('DOCS_ENCODING_INVALID', 422, 'Trang không phải UTF-8 hợp lệ');
    }
    return {
      projectId,
      snapshotId: snapshot.id as Id,
      path,
      text,
      sha256: file.sha as string,
      sourceCommit: snapshot.source_commit as string | null,
      auditState: snapshot.audit_state as AuditState,
      contentClass: file.content_class as ContentClass,
      receivedAt: (snapshot.received_at as Date).toISOString(),
      relatedTicketIds: await relatedTickets(tx, projectId, snapshot.id as Id, path),
    };
  });
}
export const docsSourceReader: DocsSourceReader = async (tx, projectId, snapshotId, path) => {
  if (!validPath(path)) return false;
  const rows =
    await tx`select 1 from docs_snapshots s join docs_files f on f.snapshot_id=s.id where s.project_id=${projectId} and s.id=${snapshotId} and f.path=${path}`;
  return rows.length > 0;
};
const requiredPages = [
  'AGENTS.md',
  'CLAUDE.md',
  'docs/index.md',
  'docs/architecture.md',
  'docs/flows.yaml',
  'docs/files.md',
];
export const docsCompletionReader: DocsCompletionReader = async (tx, projectId, commit) => {
  if (!commit) return null;
  const [snapshot] =
    await tx`select s.id,s.source_commit from docs_snapshots s join projects p on p.latest_verified_snapshot_id=s.id and p.id=s.project_id where s.project_id=${projectId} and s.audit_state='verified' and s.source_kind='checkout_sync' and s.source_commit=${commit} and p.expected_commit=${commit} and exists(select 1 from docs_sync_receipts r join attempts a on a.id=r.attempt_id join tickets t on t.id=a.ticket_id where r.snapshot_id=s.id and r.merged_commit=${commit} and t.project_id=s.project_id)`;
  if (!snapshot) return null;
  const rows =
    await tx`select path,bytes from docs_files where snapshot_id=${snapshot.id} and content_class='implemented'`;
  const paths = new Set(rows.map((row) => row.path as string));
  if (!requiredPages.every((path) => paths.has(path))) return null;
  const manifestFile = rows.find((row) => row.path === 'docs/flows.yaml');
  if (!manifestFile) return null;
  let manifest: ReturnType<typeof parseManifest>['manifest'] = null;
  try {
    manifest = parseManifest(
      new TextDecoder('utf-8', { fatal: true }).decode(manifestFile.bytes as Buffer),
    ).manifest;
  } catch {
    return null;
  }
  return manifest && Object.values(manifest.flows).every((flow) => paths.has(flow.doc)) ? commit : null;
};
export async function readProjectDocsState(
  db: Db | Tx,
  projectId: Id,
): Promise<'missing' | 'unverified' | 'invalid' | 'current' | 'stale'> {
  const [snapshot] =
    await db`select s.audit_state,s.source_commit,p.expected_commit from projects p join lateral(select audit_state,source_commit from docs_snapshots where project_id=p.id order by received_at desc,id desc limit 1) s on true where p.id=${projectId}`;
  if (!snapshot) return 'missing';
  if (snapshot.audit_state !== 'verified') return snapshot.audit_state as 'unverified' | 'invalid';
  return snapshot.source_commit &&
    snapshot.expected_commit &&
    snapshot.source_commit === snapshot.expected_commit
    ? 'current'
    : 'stale';
}
