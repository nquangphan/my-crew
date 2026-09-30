#!/usr/bin/env node
/**
 * The stable code-signing identity of 2P Crew: a self-signed certificate ("2P Crew Code Signing", code-signing
 * EKU, 10 years) whose public part is `signing/codesign-cert.crt`. macOS ties privacy grants (Full Disk Access,
 * folder access) to an app's designated requirement; an ad-hoc signature changes with every build, so every
 * update asked again. Signed with this certificate, the designated requirement is anchored to the certificate's
 * hash (`certificate root = H"…"`, the root being the leaf for a self-signed certificate) and stays the same
 * across builds.
 *
 *   node scripts/codesign.mjs verify <App.app>...
 *     Checks each app's signature (`codesign --verify --deep --strict`) and that its designated requirement
 *     names the bundle identifier and the committed certificate's SHA-1 (CI runs this after packaging).
 *
 * `package-mac.mjs` imports `signApp()` to re-sign the packed app (electron-builder only signs with identities
 * macOS trusts, which a self-signed certificate is not): the identity comes from the keychain (CI imports the
 * p12 from the CREW_CODESIGN_P12_BASE64 / CREW_CODESIGN_P12_PASSWORD secrets into a temporary keychain; locally
 * the owner's login keychain). Without it the app stays ad-hoc signed, with a warning, unless
 * CREW_CODESIGN_REQUIRED=1 (CI with the secrets set), which fails the build instead.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const CERT_FILE = join(root, 'signing', 'codesign-cert.crt');
export const BUNDLE_ID = 'com.2p-solutions.crew';

/** SHA-1 of the committed certificate (DER), uppercase hex: what codesign and the requirement use. */
export function certificateHash(pem = readFileSync(CERT_FILE, 'utf8')) {
  return createHash('sha1').update(new X509Certificate(pem).raw).digest('hex').toUpperCase();
}

/**
 * Why a designated requirement does not pin the app to the certificate (null: it does): it must name the bundle
 * identifier and the certificate's hash as the leaf or (self-signed) root.
 */
export function requirementProblem(requirement, hash, bundleId = BUNDLE_ID) {
  const text = requirement.replace(/\s+/g, ' ');
  if (!text.includes(`identifier "${bundleId}"`))
    return `the designated requirement does not name ${bundleId}`;
  const anchored = new RegExp(`certificate (leaf|root) = H"${hash}"`, 'i');
  if (!anchored.test(text)) return `the designated requirement is not anchored to the certificate ${hash}`;
  return null;
}

/** The identity's hash when the keychain has the private key for the committed certificate, else null. */
export function findIdentity(hash = certificateHash()) {
  const run = spawnSync('/usr/bin/security', ['find-identity', '-p', 'codesigning'], { encoding: 'utf8' });
  return run.status === 0 && run.stdout.toUpperCase().includes(hash) ? hash : null;
}

/** Re-signs a packed app (its nested frameworks and helpers first, through --deep) with the identity. */
export function signApp(appPath, identity) {
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--timestamp=none', '--sign', identity, appPath], {
    stdio: 'inherit',
  });
}

/** Verifies one signed app; throws with the reason. */
export function verifyApp(appPath, hash = certificateHash()) {
  const verify = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], {
    encoding: 'utf8',
  });
  if (verify.status !== 0) throw new Error(`${appPath}: codesign --verify failed: ${verify.stderr.trim()}`);
  const shown = spawnSync('/usr/bin/codesign', ['-d', '-r-', appPath], { encoding: 'utf8' });
  const requirement = `${shown.stdout}${shown.stderr}`
    .split('\n')
    .find((line) => line.startsWith('designated =>'));
  if (!requirement) throw new Error(`${appPath}: no designated requirement (unsigned or ad-hoc?)`);
  const problem = requirementProblem(requirement, hash);
  if (problem) throw new Error(`${appPath}: ${problem}: ${requirement}`);
  return requirement;
}

function main() {
  const [command, ...apps] = process.argv.slice(2);
  if (command !== 'verify' || apps.length === 0) throw new Error('usage: codesign.mjs verify <App.app>...');
  const hash = certificateHash();
  for (const app of apps) console.log(`ok: ${app}\n  ${verifyApp(app, hash)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
