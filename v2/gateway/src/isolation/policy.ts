import { isAbsolute, normalize } from 'node:path';
import { canonicalJson, hash } from '../journal/atomic-records.ts';

export const ISOLATION_POLICY_VERSION = 'crew-source-preflight-v1';
export type PolicyInput = {
  workspace: string;
  attemptHome: string;
  projectionRoot: string;
  executable: string;
  operationRoot: string;
};
function path(value: string): string {
  if (
    !isAbsolute(value) ||
    normalize(value) !== value ||
    [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    value === '/'
  )
    throw new Error('UNSAFE_POLICY_PATH');
  return JSON.stringify(value);
}
/** This is a no-model measurement policy, never an invocation certificate. */
export function isolationPolicy(input: PolicyInput): string {
  const read = [input.workspace, input.attemptHome, input.projectionRoot, input.operationRoot];
  return [
    '(version 1)',
    '(allow default)',
    '(deny process-fork)',
    '(deny network*)',
    '(deny mach-lookup (global-name "com.apple.securityd") (global-name "com.apple.securityd.xpc") (global-name "com.apple.securityd.system"))',
    '(deny file-read*)',
    '(allow file-read-metadata)',
    // macOS dyld-support.sb: libignition opens / as an openat root; this grants no descendants.
    '(allow file-read* (literal "/"))',
    `(allow file-read* ${['/System', '/Library/Apple', '/private/var/db/dyld', '/usr/lib', '/usr/share', '/private/etc', '/dev', '/bin', '/usr/bin'].map((p) => `(subpath ${path(p)})`).join(' ')} (literal ${path(input.executable)}) ${read.map((p) => `(subpath ${path(p)})`).join(' ')})`,
    `(deny file-read* (subpath ${path(`${input.workspace}/.git`)}))`,
    '(deny file-write*)',
    `(allow file-write* (literal "/dev/null") (subpath ${path(input.attemptHome)}) (subpath ${path(input.operationRoot)}))`,
  ]
    .filter(Boolean)
    .join('\n');
}
export function policyIdentity(policy: string): string {
  return hash(canonicalJson({ version: ISOLATION_POLICY_VERSION, sandbox: policy }));
}
export function routerPolicy() {
  return Object.freeze({
    version: ISOLATION_POLICY_VERSION,
    workflowSource: null,
    productionEnabled: false,
    blockers: ['INVOCATION_CERTIFICATE_MISSING', 'DESCENDANT_TREE_CERTIFICATE_MISSING'],
  });
}
