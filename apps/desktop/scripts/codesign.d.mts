/** Types of `codesign.mjs` for the TypeScript tests. */
export const CERT_FILE: string;
export const BUNDLE_ID: string;
export function certificateHash(pem?: string): string;
export function requirementProblem(requirement: string, hash: string, bundleId?: string): string | null;
export function findIdentity(hash?: string): string | null;
export function signApp(appPath: string, identity: string): void;
export function verifyApp(appPath: string, hash?: string): string;
