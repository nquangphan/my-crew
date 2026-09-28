import { scanPatch } from '../secret-scan.js';
import type { Violation } from './types.js';

/** R7: the lines a staged or pushed diff adds must not contain a credential. */
export function checkSecrets(patch: string, gitleaksBinary?: string | null): Violation[] {
  const { findings } = scanPatch(patch, gitleaksBinary);
  return findings.map((finding) => ({
    rule: 'R7',
    path: finding.path,
    message: `line ${finding.line} looks like a credential (${finding.rule}); remove it from the change (and rotate it if it is real) — credentials never leave the machine`,
  }));
}
