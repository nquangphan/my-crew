import { FLOWS_MANIFEST_PATH } from '../manifest.js';
import type { Violation } from './types.js';

/** R5: a repo without `docs/flows.yaml` has not adopted the docs standard (exit 3, NOT_INITIALIZED). */
export function notInitialized(where: string): Violation {
  return {
    rule: 'R5',
    path: FLOWS_MANIFEST_PATH,
    message: `NOT_INITIALIZED: no ${FLOWS_MANIFEST_PATH} in the ${where}; run \`crew-docs init\` and complete the docs-init checklist`,
  };
}
