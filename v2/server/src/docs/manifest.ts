import { posix } from 'node:path';
import picomatch from 'picomatch';
import { parseDocument } from 'yaml';
import type { AuditIssue } from './contracts.ts';

export type Manifest = {
  version: 1;
  source: { include: string[]; exclude: string[] };
  flows: Record<
    string,
    { title: string; doc: string; entrypoints: string[]; files: string[]; tests: string[] }
  >;
  shared: Record<string, string[]>;
  unassigned: { path: string; reason: string }[];
};

const issue = (message: string): AuditIssue => ({
  code: 'MANIFEST_INVALID',
  path: 'docs/flows.yaml',
  message,
  severity: 'error',
});
const own = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((item) => typeof item === 'string' && item.length > 0) &&
  new Set(value).size === value.length;
const safeKey = (key: string) => key !== '__proto__' && key !== 'constructor' && key !== 'prototype';

export function validPath(path: string): boolean {
  if (
    path.length < 1 ||
    path.length > 1024 ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.startsWith('/') ||
    path.includes('?') ||
    path.includes('#')
  )
    return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  if (
    decoded.includes('\\') ||
    decoded.includes('\0') ||
    decoded.startsWith('/') ||
    decoded.includes('?') ||
    decoded.includes('#')
  )
    return false;
  return [path, decoded].every((item) =>
    item.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
  );
}

export function allowedDocsPath(path: string): boolean {
  return (
    validPath(path) &&
    (path === 'AGENTS.md' ||
      path === 'CLAUDE.md' ||
      path.startsWith('docs/') ||
      path.startsWith('_bmad-output/'))
  );
}

export function requiredClass(path: string): 'implemented' | 'workflow_artifact' | null {
  if (
    path.startsWith('_bmad-output/') ||
    /^(docs\/superpowers\/(specs|plans)\/|docs\/bmad\/|docs\/artifacts\/)/.test(path)
  )
    return 'workflow_artifact';
  if (
    path === 'AGENTS.md' ||
    path === 'CLAUDE.md' ||
    /^(docs\/(index|architecture|files)\.md|docs\/flows\.yaml|docs\/flows\/[^/]+\.md)$/.test(path)
  )
    return 'implemented';
  return null;
}

export function parseManifest(text: string): { manifest: Manifest | null; issues: AuditIssue[] } {
  if (text.length > 1024 * 1024) return { manifest: null, issues: [issue('Manifest vượt giới hạn 1 MiB')] };
  try {
    const doc = parseDocument(text, { uniqueKeys: true });
    if (doc.errors.length) return { manifest: null, issues: doc.errors.map((error) => issue(error.message)) };
    const value: unknown = doc.toJS({ maxAliasCount: 50 });
    if (
      !own(value) ||
      !exact(value, ['version', 'source', 'flows', 'shared', 'unassigned']) ||
      value.version !== 1
    )
      throw new Error('Cấu trúc manifest không hợp lệ');
    if (
      !own(value.source) ||
      !exact(value.source, ['include', 'exclude']) ||
      !strings(value.source.include) ||
      !strings(value.source.exclude) ||
      value.source.include.length === 0
    )
      throw new Error('source.include/exclude không hợp lệ');
    if (!own(value.flows) || !own(value.shared) || !Array.isArray(value.unassigned))
      throw new Error('flows/shared/unassigned không hợp lệ');
    for (const [id, entry] of Object.entries(value.flows)) {
      if (
        !safeKey(id) ||
        !/^[a-z][a-z0-9-]*$/.test(id) ||
        !own(entry) ||
        !exact(entry, ['title', 'doc', 'entrypoints', 'files', 'tests']) ||
        typeof entry.title !== 'string' ||
        !entry.title.trim() ||
        typeof entry.doc !== 'string' ||
        !validPath(entry.doc) ||
        entry.doc !== `docs/flows/${id}.md` ||
        !strings(entry.entrypoints) ||
        !strings(entry.files) ||
        !strings(entry.tests)
      )
        throw new Error(`Flow ${id} không hợp lệ`);
      if (![...entry.entrypoints, ...entry.files, ...entry.tests].every(validPath))
        throw new Error(`Path của flow ${id} không hợp lệ`);
    }
    for (const [path, targets] of Object.entries(value.shared)) {
      if (
        !safeKey(path) ||
        !validPath(path) ||
        !strings(targets) ||
        targets.length === 0 ||
        targets.some((id) => !Object.hasOwn(value.flows as object, id))
      )
        throw new Error(`shared ${path} không hợp lệ`);
    }
    const unassignedPaths = new Set<string>();
    for (const entry of value.unassigned) {
      if (
        !own(entry) ||
        !exact(entry, ['path', 'reason']) ||
        typeof entry.path !== 'string' ||
        !validPath(entry.path) ||
        typeof entry.reason !== 'string' ||
        !entry.reason.trim() ||
        unassignedPaths.has(entry.path)
      )
        throw new Error('unassigned không hợp lệ');
      unassignedPaths.add(entry.path);
    }
    const manifest = value as Manifest;
    for (const path of mappedPaths(manifest))
      if (unassignedPaths.has(path)) throw new Error(`${path} vừa thuộc flow vừa unassigned`);
    return { manifest, issues: [] };
  } catch (error) {
    return { manifest: null, issues: [issue(error instanceof Error ? error.message : 'Không thể đọc YAML')] };
  }
}

export function mappedPaths(manifest: Manifest): Set<string> {
  const paths = new Set<string>();
  for (const flow of Object.values(manifest.flows))
    for (const path of [...flow.entrypoints, ...flow.files, ...flow.tests]) paths.add(path);
  for (const path of Object.keys(manifest.shared)) paths.add(path);
  return paths;
}

export function sourceMatcher(manifest: Manifest): (path: string) => boolean {
  const include = picomatch(manifest.source.include, { dot: true });
  const exclude = picomatch(manifest.source.exclude, { dot: true });
  return (path) => include(path) && !exclude(path);
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const code = (text: string) => `\`${cell(text)}\``;
const link = (from: string, to: string) => posix.relative(posix.dirname(from), to);

export function expectedFlowBlock(manifest: Manifest): string {
  const ids = Object.keys(manifest.flows).sort();
  if (!ids.length) return '_Chưa có flow nào trong `docs/flows.yaml`._';
  return [
    '| Flow | Id | Điểm vào |',
    '|------|----|----------|',
    ...ids.map((id) => {
      const flow = manifest.flows[id];
      if (!flow) throw new Error(`Flow ${id} không tồn tại`);
      return `| [${cell(flow.title)}](${link('docs/index.md', flow.doc)}) | ${code(id)} | ${flow.entrypoints.map(code).join(', ') || '—'} |`;
    }),
  ].join('\n');
}

export function expectedFilesBlock(manifest: Manifest): string {
  const roles: Record<string, { id: string; role: string; doc: string }[]> = Object.create(null);
  for (const [id, flow] of Object.entries(manifest.flows))
    for (const [role, paths] of [
      ['điểm vào', flow.entrypoints],
      ['file', flow.files],
      ['test', flow.tests],
    ] as const)
      for (const path of paths) {
        roles[path] ??= [];
        roles[path].push({ id, role, doc: flow.doc });
      }
  for (const [path, ids] of Object.entries(manifest.shared))
    for (const id of ids) {
      roles[path] ??= [];
      const flow = manifest.flows[id];
      if (!flow) throw new Error(`Flow ${id} không tồn tại`);
      roles[path].push({ id, role: 'dùng chung', doc: flow.doc });
    }
  const lines = [
    '> Sinh tự động bởi `crew-docs generate` từ `docs/flows.yaml`. Không sửa tay.',
    '',
    '| File | Flows |',
    '|------|-------|',
  ];
  for (const path of Object.keys(roles).sort())
    lines.push(
      `| ${code(path)} | ${(roles[path] ?? [])
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((owner) => `[${owner.id}](${link('docs/files.md', owner.doc)}) (${owner.role})`)
        .join(', ')} |`,
    );
  if (manifest.unassigned.length) {
    lines.push('', '### Không thuộc flow (unassigned)', '', '| File | Lý do |', '|------|-------|');
    for (const entry of [...manifest.unassigned].sort((a, b) => a.path.localeCompare(b.path)))
      lines.push(`| ${code(entry.path)} | ${cell(entry.reason)} |`);
  }
  return lines.join('\n');
}

export function actualBlock(text: string, name: 'flows' | 'files'): string | null {
  const normalized = text.replace(/\r\n/g, '\n');
  const start = `<!-- crew-docs:${name}:start -->`;
  const end = `<!-- crew-docs:${name}:end -->`;
  const from = normalized.indexOf(start);
  const to = normalized.indexOf(end);
  if (
    from < 0 ||
    to <= from ||
    normalized.indexOf(start, from + start.length) >= 0 ||
    normalized.indexOf(end, to + end.length) >= 0
  )
    return null;
  return normalized
    .slice(from + start.length, to)
    .replace(/^\n/, '')
    .replace(/\n$/, '');
}
