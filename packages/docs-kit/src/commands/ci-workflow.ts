import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TEMPLATES } from '../templates.js';
import { EXIT, type Io } from './io.js';

export const WORKFLOW_PATH = '.github/workflows/crew-docs.yml';
/** The workflow runs this vendored copy of the bundle, so CI needs no network access to 2P Crew. */
export const VENDORED_BUNDLE_PATH = '.github/crew-docs/crew-docs.cjs';

function writeIfChanged(file: string, content: string): boolean {
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return true;
}

/** `crew-docs ci-workflow`: writes the GitHub Actions workflow and vendors the running bundle next to it. */
export function ciWorkflowCommand(root: string, bundle: string, io: Io): number {
  const workflow = join(root, WORKFLOW_PATH);
  io.out(`${writeIfChanged(workflow, TEMPLATES.ciWorkflow) ? 'updated' : 'unchanged'} ${WORKFLOW_PATH}`);
  const vendored = join(root, VENDORED_BUNDLE_PATH);
  const same = existsSync(vendored) && readFileSync(vendored).equals(readFileSync(bundle));
  if (!same) {
    mkdirSync(dirname(vendored), { recursive: true });
    copyFileSync(bundle, vendored);
  }
  io.out(`${same ? 'unchanged' : 'updated'} ${VENDORED_BUNDLE_PATH}`);
  return EXIT.ok;
}
