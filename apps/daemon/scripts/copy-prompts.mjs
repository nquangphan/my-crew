// Copies the role prompt templates (versioned Markdown) next to the compiled role planner, which reads
// them at runtime from `roles/prompts/` beside itself. tsc only emits `.ts` sources.
import { cpSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { compilerOptions } = JSON.parse(readFileSync(join(root, 'tsconfig.build.json'), 'utf8'));
const from = join(root, 'src', 'roles', 'prompts');
const to = join(root, compilerOptions.outDir, 'roles', 'prompts');
cpSync(from, to, { recursive: true, filter: (path) => statSync(path).isDirectory() || path.endsWith('.md') });
console.log(`copied role prompts to ${to}`);
