import type { AuditIssue, DocsValidationInput, DocsValidationResult } from './contracts.ts';
import { auditLinks } from './links.ts';
import {
  actualBlock,
  allowedDocsPath,
  expectedFilesBlock,
  expectedFlowBlock,
  mappedPaths,
  parseManifest,
  requiredClass,
  sourceMatcher,
} from './manifest.ts';

const required = [
  'AGENTS.md',
  'CLAUDE.md',
  'docs/index.md',
  'docs/architecture.md',
  'docs/flows.yaml',
  'docs/files.md',
];
const headings = ['Mục đích', 'Điểm vào', 'Các bước', 'Files', 'Dữ liệu', 'Flow liên quan', 'Tests'];

function outsideFences(page: string): string[] {
  const visible: string[] = [];
  let fence: string | null = null;
  for (const line of page.split(/\r?\n/)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence === null) visible.push(line);
  }
  return visible;
}

function validFlowSteps(page: string): boolean {
  let inSteps = false;
  let count = 0;
  for (const line of outsideFences(page)) {
    const section = /^## (.+?)\s*$/.exec(line);
    if (section) {
      if (inSteps) break;
      inSteps = section[1] === 'Các bước';
      continue;
    }
    if (!inSteps) continue;
    const numbered = /^\s*\d+\.(?:[ \t]+(.*))?$/.exec(line);
    if (!numbered) continue;
    count++;
    if (!/^`[^`]+`\s*→\s*`[^`]+`\s*:/.test(numbered[1] ?? '')) return false;
  }
  return count > 0;
}

export function validateDocs(input: DocsValidationInput): DocsValidationResult {
  const issues: AuditIssue[] = [];
  const texts = new Map<string, string>();
  const add = (code: string, path: string, message: string, severity: AuditIssue['severity'] = 'error') =>
    issues.push({ code, path, message, severity });
  for (const [path, bytes] of input.files) {
    if (!allowedDocsPath(path)) {
      add('PATH_INVALID', path, 'Đường dẫn tài liệu không an toàn hoặc ngoài danh sách cho phép');
      continue;
    }
    if (!Buffer.isBuffer(bytes) || bytes.length > 1024 * 1024) {
      add('FILE_TOO_LARGE', path, 'File phải là Buffer tối đa 1 MiB');
      continue;
    }
    const declared = input.contentClasses.get(path);
    if (declared !== 'implemented' && declared !== 'workflow_artifact')
      add('CONTENT_CLASS_MISSING', path, 'Thiếu phân loại nội dung');
    const expected = requiredClass(path);
    if (expected !== null && declared !== expected)
      add('CONTENT_CLASS_MISMATCH', path, `Trang này phải có contentClass ${expected}`);
    try {
      texts.set(path, new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      add('INVALID_UTF8', path, 'Nội dung không phải UTF-8 hợp lệ');
    }
  }
  if (input.files.size > 2000) add('FILE_COUNT_LIMIT', 'docs/', 'Vượt 2000 file trong một snapshot');
  const artifactOnly =
    input.files.size > 0 &&
    [...input.files.keys()].every((path) => input.contentClasses.get(path) === 'workflow_artifact');
  if (!artifactOnly)
    for (const path of required)
      if (!texts.has(path) || input.contentClasses.get(path) !== 'implemented')
        add('REQUIRED_DOC_MISSING', path, 'Thiếu trang chuẩn đã triển khai');
  const claude = texts.get('CLAUDE.md');
  if (claude !== undefined && !/^@AGENTS\.md(?:\r?\n)?$/.test(claude))
    add('CLAUDE_REDIRECT_INVALID', 'CLAUDE.md', 'CLAUDE.md phải chỉ chứa @AGENTS.md');

  const manifestText = texts.get('docs/flows.yaml');
  const parsed = manifestText !== undefined ? parseManifest(manifestText) : { manifest: null, issues: [] };
  issues.push(...parsed.issues);
  const manifest = parsed.manifest;
  if (manifest) {
    for (const [id, flow] of Object.entries(manifest.flows)) {
      if (!texts.has(flow.doc) || input.contentClasses.get(flow.doc) !== 'implemented')
        add('FLOW_DOC_MISSING', flow.doc, `Thiếu trang flow ${id}`);
      else {
        const page = texts.get(flow.doc) ?? '';
        const visible = outsideFences(page).join('\n');
        const actual = [...visible.matchAll(/^## (.+?)\s*$/gm)].map((match) => match[1]);
        if (
          !/^# [^\n]+/m.test(visible) ||
          actual.length !== headings.length ||
          actual.some((heading, i) => heading !== headings[i])
        )
          add('FLOW_HEADINGS_INVALID', flow.doc, 'Heading flow phải đúng thứ tự của STANDARD');
        if (!validFlowSteps(page))
          add('FLOW_STEPS_INVALID', flow.doc, 'Các bước cần danh sách đánh số với file → symbol');
      }
      for (const path of [flow.doc, ...flow.entrypoints, ...flow.files, ...flow.tests]) {
        if (path.startsWith('docs/')) {
          if (!input.files.has(path))
            add('MANIFEST_FILE_MISSING', path, `Manifest tham chiếu file vắng mặt (${id})`);
        } else if (input.mode === 'checkout_sync' && !input.trackedSourcePaths.includes(path))
          add('MANIFEST_FILE_MISSING', path, `Manifest tham chiếu nguồn vắng mặt (${id})`);
      }
    }
    for (const path of Object.keys(manifest.shared))
      if (input.mode === 'checkout_sync' && !input.trackedSourcePaths.includes(path))
        add('MANIFEST_FILE_MISSING', path, 'shared tham chiếu nguồn vắng mặt');
    for (const item of manifest.unassigned)
      if (input.mode === 'checkout_sync' && !input.trackedSourcePaths.includes(item.path))
        add('MANIFEST_FILE_MISSING', item.path, 'unassigned tham chiếu nguồn vắng mặt');
    for (const [path, expected] of [
      ['docs/index.md', expectedFlowBlock(manifest)],
      ['docs/files.md', expectedFilesBlock(manifest)],
    ] as const) {
      const text = texts.get(path);
      if (text !== undefined && actualBlock(text, path === 'docs/index.md' ? 'flows' : 'files') !== expected)
        add('GENERATED_BLOCK_STALE', path, 'Block sinh tự động khác manifest');
    }
    if (input.mode === 'legacy_import')
      add(
        'SOURCE_TREE_UNVERIFIED',
        'docs/flows.yaml',
        'Bản nhập chỉ có docs, chưa đối chiếu source tree với checkout',
        'warning',
      );
    else {
      const matches = sourceMatcher(manifest);
      const assigned = mappedPaths(manifest);
      const unassigned = new Set(manifest.unassigned.map((item) => item.path));
      for (const path of input.trackedSourcePaths) {
        if (!matches(path)) continue;
        if (!assigned.has(path) && !unassigned.has(path))
          add('SOURCE_UNMAPPED', path, 'File nguồn chưa thuộc flow hoặc unassigned');
      }
    }
  }
  const linked = auditLinks(texts);
  issues.push(...linked.issues);
  return { issues, valid: !issues.some((item) => item.severity === 'error'), links: linked.links };
}
