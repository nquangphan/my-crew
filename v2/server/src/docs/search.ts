import { createHash } from 'node:crypto';
import type { Actor, Db, Id } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type { ContentClass } from './contracts.ts';
import { projectStorageText } from './import.ts';
import { type AuditState, requireDocsScope } from './read.ts';
export type DocsHit = {
  snapshotId: Id;
  projectId: Id;
  path: string;
  title: string;
  snippet: string;
  sha256: string;
  sourceCommit: string | null;
  auditState: AuditState;
  contentClass: ContentClass;
  score: number;
  relatedTicketIds: Id[];
};
export type SearchInput = { q: string; projectId?: Id; snapshotId?: Id; after?: string; limit: number };
type Cursor = { hash: string; score: number; projectId: Id; snapshotId: Id; path: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function invalid(): never {
  throw new ApiError('CURSOR_INVALID', 400, 'Con trỏ tìm kiếm không hợp lệ');
}
function snippet(text: string, q: string): string {
  const chars = Array.from(text);
  const match = text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase());
  const start = match < 0 ? 0 : Math.max(0, Array.from(text.slice(0, match)).length - 60);
  return chars.slice(start, start + 240).join('');
}
export async function searchDocs(
  db: Db,
  input: SearchInput,
  actor: Actor,
): Promise<{ items: DocsHit[]; nextCursor: string | null }> {
  if (typeof input.q !== 'string' || !input.q.trim() || Array.from(input.q).length > 256)
    throw new ApiError('QUERY_INVALID', 400, 'Từ khóa phải có 1–256 ký tự');
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100)
    throw new ApiError('LIMIT_INVALID', 400, 'Giới hạn không hợp lệ');
  const q = projectStorageText(input.q);
  const hash = createHash('sha256')
    .update(JSON.stringify([input.q, input.projectId ?? null, input.snapshotId ?? null]))
    .digest('hex');
  let cursor: Cursor | null = null;
  if (input.after) {
    if (input.after.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(input.after)) invalid();
    try {
      cursor = JSON.parse(Buffer.from(input.after, 'base64url').toString('utf8')) as Cursor;
    } catch {
      invalid();
    }
    if (
      !cursor ||
      typeof cursor !== 'object' ||
      Object.keys(cursor).sort().join(',') !== 'hash,path,projectId,score,snapshotId' ||
      cursor.hash !== hash ||
      !Number.isFinite(cursor.score) ||
      cursor.score < 0 ||
      typeof cursor.path !== 'string' ||
      cursor.path.length > 1024 ||
      !uuid.test(cursor.projectId) ||
      !uuid.test(cursor.snapshotId)
    )
      invalid();
  }
  const pattern = `%${q.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
  return db.begin('isolation level repeatable read read only', async (tx) => {
    if (input.projectId) await requireDocsScope(tx, input.projectId, actor);
    if (input.snapshotId) {
      const [selected] =
        await tx`select project_id from docs_snapshots where id=${input.snapshotId} and (${input.projectId ?? null}::uuid is null or project_id=${input.projectId ?? null})`;
      if (!selected) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy tài liệu');
      await requireDocsScope(tx, selected.project_id as Id, actor);
    }
    const rows = await tx`with selected as (
      select s.* from projects p join lateral (select * from docs_snapshots s where s.project_id=p.id and (${input.snapshotId ?? null}::uuid is null or s.id=${input.snapshotId ?? null}) order by received_at desc,id desc limit 1) s on true
      where (${input.projectId ?? null}::uuid is null or p.id=${input.projectId ?? null}) and (${actor.kind === 'owner'} or (p.machine_id=${actor.kind === 'machine' ? actor.id : null}::uuid and exists(select 1 from machines m where m.id=p.machine_id and m.revoked_at is null)))
    ), hits as (
      select s.id snapshot_id,s.project_id,s.source_commit,s.audit_state,f.path,f.title,f.sha,f.content_class,f.search_text,ts_rank(f.search_vector,websearch_to_tsquery('simple',${q}))::float8 score
      from selected s join docs_files f on f.snapshot_id=s.id where f.search_vector @@ websearch_to_tsquery('simple',${q}) or f.search_text ilike ${pattern} escape '\\'
    ) select * from hits where (${cursor === null} or score<${cursor?.score ?? 0} or (score=${cursor?.score ?? 0} and (project_id,snapshot_id,path)>(${cursor?.projectId ?? null}::uuid,${cursor?.snapshotId ?? null}::uuid,${cursor?.path ?? null}::text))) order by score desc,project_id,snapshot_id,path limit ${input.limit + 1}`;
    const items: DocsHit[] = [];
    for (const row of rows.slice(0, input.limit)) {
      const related =
        await tx`select distinct t.id from ticket_docs d join tickets t on t.id=d.ticket_id where t.project_id=${row.project_id} and d.snapshot_id=${row.snapshot_id} and d.path=${row.path} order by t.id limit 20`;
      items.push({
        snapshotId: row.snapshot_id as Id,
        projectId: row.project_id as Id,
        path: row.path as string,
        title: row.title as string,
        snippet: snippet(row.search_text as string, q),
        sha256: row.sha as string,
        sourceCommit: row.source_commit as string | null,
        auditState: row.audit_state as AuditState,
        contentClass: row.content_class as ContentClass,
        score: Number(row.score),
        relatedTicketIds: related.map((ticket) => ticket.id as Id),
      });
    }
    const last = items.at(-1);
    const nextCursor =
      rows.length > input.limit && last
        ? Buffer.from(
            JSON.stringify({
              hash,
              score: last.score,
              projectId: last.projectId,
              snapshotId: last.snapshotId,
              path: last.path,
            } satisfies Cursor),
          ).toString('base64url')
        : null;
    return { items, nextCursor };
  });
}
