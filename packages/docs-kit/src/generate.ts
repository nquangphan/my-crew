import { posix } from 'node:path';
import { type FlowsManifest, flowsForPath } from './flows-schema.js';

export const INDEX_PATH = 'docs/index.md';
export const FILES_PATH = 'docs/files.md';

export interface GeneratedBlock {
  name: 'flows' | 'files';
  path: string;
}

export const FLOWS_BLOCK: GeneratedBlock = { name: 'flows', path: INDEX_PATH };
export const FILES_BLOCK: GeneratedBlock = { name: 'files', path: FILES_PATH };

const startMarker = (name: string) => `<!-- crew-docs:${name}:start -->`;
const endMarker = (name: string) => `<!-- crew-docs:${name}:end -->`;

/** Escapes text for a markdown table cell. */
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const code = (text: string) => `\`${cell(text)}\``;
/** A link from `docs/<page>.md` to another repo path. */
const docLink = (from: string, target: string) => posix.relative(posix.dirname(from), target);

const ROLE_LABEL = { entrypoint: 'điểm vào', file: 'file', test: 'test', shared: 'dùng chung' } as const;

function flowsBlockBody(manifest: FlowsManifest): string {
  const ids = Object.keys(manifest.flows).sort();
  if (ids.length === 0) return '_Chưa có flow nào trong `docs/flows.yaml`._';
  const rows = ids.map((id) => {
    const flow = manifest.flows[id];
    if (!flow) return '';
    const entrypoints = flow.entrypoints.map(code).join(', ') || '—';
    return `| [${cell(flow.title)}](${docLink(INDEX_PATH, flow.doc)}) | ${code(id)} | ${entrypoints} |`;
  });
  return ['| Flow | Id | Điểm vào |', '|------|----|----------|', ...rows].join('\n');
}

function filesBlockBody(manifest: FlowsManifest): string {
  const paths = new Set<string>();
  for (const flow of Object.values(manifest.flows)) {
    for (const path of [...flow.entrypoints, ...flow.files, ...flow.tests]) paths.add(path);
  }
  for (const path of Object.keys(manifest.shared)) paths.add(path);
  const lines = [
    '> Sinh tự động bởi `crew-docs generate` từ `docs/flows.yaml`. Không sửa tay.',
    '',
    '| File | Flows |',
    '|------|-------|',
  ];
  for (const path of [...paths].sort()) {
    const owners = flowsForPath(manifest, path).flows.map(
      (owner) =>
        `[${owner.flowId}](${docLink(FILES_PATH, owner.doc || `docs/flows/${owner.flowId}.md`)}) (${ROLE_LABEL[owner.role]})`,
    );
    lines.push(`| ${code(path)} | ${owners.join(', ')} |`);
  }
  if (manifest.unassigned.length > 0) {
    lines.push('', '### Không thuộc flow (unassigned)', '', '| File | Lý do |', '|------|-------|');
    for (const entry of [...manifest.unassigned].sort((a, b) => a.path.localeCompare(b.path))) {
      lines.push(`| ${code(entry.path)} | ${cell(entry.reason)} |`);
    }
  }
  return lines.join('\n');
}

export function blockBody(block: GeneratedBlock, manifest: FlowsManifest): string {
  return block.name === 'flows' ? flowsBlockBody(manifest) : filesBlockBody(manifest);
}

function renderBlock(block: GeneratedBlock, manifest: FlowsManifest): string {
  return `${startMarker(block.name)}\n${blockBody(block, manifest)}\n${endMarker(block.name)}`;
}

/** The current body between a block's markers, or null when the markers are missing or out of order. */
export function extractBlock(text: string, block: GeneratedBlock): string | null {
  const normalized = text.replace(/\r\n/g, '\n');
  const start = normalized.indexOf(startMarker(block.name));
  const end = normalized.indexOf(endMarker(block.name));
  if (start < 0 || end < start) return null;
  return normalized
    .slice(start + startMarker(block.name).length, end)
    .replace(/^\n/, '')
    .replace(/\n$/, '');
}

export function isBlockCurrent(text: string, block: GeneratedBlock, manifest: FlowsManifest): boolean {
  return extractBlock(text, block) === blockBody(block, manifest);
}

/**
 * Rewrites a block in place. A page without the markers gets them: `index.md` appends a "Danh sách flow"
 * section, and `files.md` is written whole.
 */
export function applyBlock(text: string | null, block: GeneratedBlock, manifest: FlowsManifest): string {
  const rendered = renderBlock(block, manifest);
  if (text !== null) {
    const normalized = text.replace(/\r\n/g, '\n');
    const start = normalized.indexOf(startMarker(block.name));
    const endAt = normalized.indexOf(endMarker(block.name));
    if (start >= 0 && endAt > start) {
      return `${normalized.slice(0, start)}${rendered}${normalized.slice(endAt + endMarker(block.name).length)}`;
    }
    if (block.name === 'flows') {
      return `${normalized.replace(/\n*$/, '')}\n\n## Danh sách flow\n\n${rendered}\n`;
    }
  }
  if (block.name === 'flows') return `# Tổng quan\n\n## Danh sách flow\n\n${rendered}\n`;
  return `# Tra cứu file\n\nFile nào thuộc flow nào. Dùng \`crew-docs where <file>\` để tra từ dòng lệnh.\n\n${rendered}\n`;
}
