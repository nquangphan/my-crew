import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FlowId } from '@crew/shared';
import { applyBlock, FILES_BLOCK, FLOWS_BLOCK } from '../generate.js';
import { FLOWS_MANIFEST_PATH, loadManifest } from '../manifest.js';
import { renderFlowTemplate, TEMPLATES } from '../templates.js';
import { workingTreeReader } from '../tree.js';
import { EXIT, type Io, UsageError } from './io.js';

const SCAFFOLD: readonly [path: string, content: string][] = [
  ['AGENTS.md', TEMPLATES.agents],
  ['CLAUDE.md', TEMPLATES.claude],
  ['docs/index.md', TEMPLATES.index],
  ['docs/architecture.md', TEMPLATES.architecture],
  [FLOWS_MANIFEST_PATH, TEMPLATES.flowsYaml],
];

export const INIT_CHECKLIST = [
  'Checklist docs-init (chuẩn: STANDARD.md của crew-docs):',
  '  1. Điền AGENTS.md: lệnh cài đặt, build, test, lint và quy ước code. CLAUDE.md chỉ có một dòng @AGENTS.md.',
  '  2. Viết docs/index.md (mục đích, stack, bản đồ module) và docs/architecture.md.',
  '  3. Chỉnh source.include / source.exclude trong docs/flows.yaml cho đúng repo.',
  '  4. Với mỗi flow: `crew-docs init --flow <id> --title "<tên>"`, viết docs/flows/<id>.md và khai báo flow trong docs/flows.yaml.',
  '  5. Đưa mọi file nguồn vào một flow, vào shared (kèm các flow dùng nó) hoặc vào unassigned (kèm lý do).',
  '  6. Chạy `crew-docs generate`, rồi `crew-docs check --all` phải pass.',
  '  7. Trong main checkout: `crew-docs install-hooks`, rồi `crew-docs ci-workflow`.',
  '  8. Commit tất cả trong MỘT commit có trailer `Crew-Docs-Init: true`.',
];

function writeNew(root: string, path: string, content: string): boolean {
  const file = join(root, path);
  if (existsSync(file)) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return true;
}

/** Scaffolds a new flow doc from the template. */
function initFlow(root: string, id: string, title: string | undefined, io: Io): number {
  if (!FlowId.safeParse(id).success) throw new UsageError(`flow ids are kebab-case (a-z, 0-9, -): ${id}`);
  const path = `docs/flows/${id}.md`;
  if (!writeNew(root, path, renderFlowTemplate(id, title ?? id))) {
    throw new UsageError(`${path} already exists`);
  }
  io.out(`created ${path}`);
  io.out(`Khai báo flow trong ${FLOWS_MANIFEST_PATH}:`);
  io.out(
    `  ${id}:\n    title: ${title ?? id}\n    doc: ${path}\n    entrypoints: []\n    files: []\n    tests: []`,
  );
  return EXIT.ok;
}

/** `crew-docs init`: scaffolds the docs standard without overwriting anything, then prints the checklist. */
export function initCommand(root: string, options: { flow?: string; title?: string }, io: Io): number {
  if (options.flow !== undefined) return initFlow(root, options.flow, options.title, io);
  for (const [path, content] of SCAFFOLD) {
    io.out(`${writeNew(root, path, content) ? 'created' : 'kept'} ${path}`);
  }
  const tree = workingTreeReader(root);
  const result = loadManifest(tree);
  if (result.status === 'ok') {
    for (const block of [FLOWS_BLOCK, FILES_BLOCK]) {
      const current = tree.read(block.path);
      const next = applyBlock(current, block, result.manifest);
      if (next !== current) {
        writeFileSync(join(root, block.path), next);
        io.out(`generated ${block.path}`);
      }
    }
  } else {
    io.err(`${FLOWS_MANIFEST_PATH} is not valid yet; fix it, then run \`crew-docs generate\``);
  }
  for (const line of INIT_CHECKLIST) io.out(line);
  return EXIT.ok;
}
