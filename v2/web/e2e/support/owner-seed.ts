import { randomUUID } from 'node:crypto';
import { bundleHash, hashBytes, snapshotHash } from '../../../server/src/docs/checksum.ts';
import type { DocsFile } from '../../../server/src/docs/contracts.ts';
import type { FixtureHandle } from './fixture.ts';

export type SeededTicket = { projectId: string; ticketId: string; title: string };

/**
 * Creates one project and one request ticket through the real owner API of the fixture (login, CSRF,
 * idempotency key). Nothing is mocked; the data lives in the fixture's own PostgreSQL.
 */
type OwnerPost = <T>(path: string, body: unknown) => Promise<T>;

/** Logs in as the fixture owner through the real API and returns a CSRF + idempotency-key aware POST. */
async function ownerPost(crew: FixtureHandle): Promise<OwnerPost> {
  const login = await fetch(`${crew.apiOrigin}/v2/auth/session`, {
    method: 'POST',
    headers: { origin: crew.webOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({ password: crew.ownerPassword }),
    signal: AbortSignal.timeout(15_000),
  });
  if (login.status !== 200) throw new Error(`SEED_LOGIN_FAILED:${login.status}`);
  const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
  const { csrfToken } = (await login.json()) as { csrfToken?: string };
  if (!cookie || !csrfToken) throw new Error('SEED_SESSION_INVALID');
  return async <T>(path: string, body: unknown): Promise<T> => {
    const response = await fetch(`${crew.apiOrigin}${path}`, {
      method: 'POST',
      headers: {
        origin: crew.webOrigin,
        cookie,
        'x-csrf-token': csrfToken,
        'idempotency-key': randomUUID(),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 201 && response.status !== 200) {
      throw new Error(`SEED_FAILED:${path}:${response.status}:${await response.text()}`);
    }
    return (await response.json()) as T;
  };
}

/**
 * Creates one project and one request ticket through the real owner API of the fixture (login, CSRF,
 * idempotency key). Nothing is mocked; the data lives in the fixture's own PostgreSQL.
 */
export async function seedOwnerTicket(crew: FixtureHandle, title: string): Promise<SeededTicket> {
  const post = await ownerPost(crew);
  const project = await post<{ id: string }>('/v2/projects', {
    key: 'ROUTE',
    name: 'Dự án route ticket',
    repositoryUrl: null,
  });
  const ticket = await post<{ id: string }>('/v2/tickets', {
    projectId: project.id,
    parentId: null,
    level: 'request',
    kind: 'code',
    title,
    description: 'Mô tả để kiểm tra deep link.',
    mandatory: true,
    criteria: { workflowChoice: 'superpowers' },
    inputs: {},
    outputs: {},
    skill: null,
    workflowPin: null,
  });
  return { projectId: project.id, ticketId: ticket.id, title };
}

export type SeededDocs = { projectId: string; projectName: string; files: Record<string, string> };

/**
 * Imports one docs snapshot through the production route `POST /v2/docs/imports` (legacy bundle: the server
 * verifies every checksum, audits the files and creates the project). Source commit stays null, so the page
 * shows the unverified state exactly as a real legacy import does.
 */
export async function seedDocsProject(
  crew: FixtureHandle,
  files: Record<string, string>,
): Promise<SeededDocs> {
  const post = await ownerPost(crew);
  const entries: DocsFile[] = Object.entries(files).map(([path, text]) => {
    const bytes = Buffer.from(text, 'utf8');
    return {
      path,
      bytesBase64: bytes.toString('base64'),
      sha256: hashBytes(bytes),
      contentClass: path.startsWith('docs/superpowers/') ? 'workflow_artifact' : 'implemented',
    };
  });
  const projectName = 'Dự án tài liệu';
  const body = {
    sourceSystem: 'crew-v1' as const,
    backupManifestSha256: 'b'.repeat(64),
    inventory: [
      {
        legacyProjectId: 'legacy-e2e',
        key: 'DOCS',
        name: projectName,
        repositoryUrl: null,
        sourceCommit: null,
        snapshotSha256: snapshotHash(entries),
        files: entries,
      },
    ],
  };
  const result = await post<{ projects: { projectId: string }[] }>('/v2/docs/imports', {
    ...body,
    bundleSha256: bundleHash(body),
  });
  const projectId = result.projects[0]?.projectId;
  if (!projectId) throw new Error('SEED_DOCS_PROJECT_MISSING');
  return { projectId, projectName, files };
}
