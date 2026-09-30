import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BUNDLE_ID, certificateHash, requirementProblem, verifyApp } from '../scripts/codesign.mjs';

const work = mkdtempSync(join(tmpdir(), 'crew-codesign-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('stable code-signing identity', () => {
  const hash = certificateHash();

  it('pins the committed certificate', () => {
    expect(hash).toMatch(/^[0-9A-F]{40}$/);
  });

  it('accepts a designated requirement anchored to the certificate (leaf, or root for a self-signed one)', () => {
    expect(
      requirementProblem(
        `designated => identifier "${BUNDLE_ID}" and certificate root = H"${hash.toLowerCase()}"`,
        hash,
      ),
    ).toBeNull();
    expect(
      requirementProblem(`designated => identifier "${BUNDLE_ID}" and certificate leaf = H"${hash}"`, hash),
    ).toBeNull();
  });

  it('refuses an ad-hoc, foreign-certificate or wrong-identifier requirement', () => {
    expect(
      requirementProblem(`designated => cdhash H"0123456789abcdef0123456789abcdef01234567"`, hash),
    ).toMatch(/does not name/);
    expect(
      requirementProblem(
        `designated => identifier "${BUNDLE_ID}" and certificate root = H"${'0'.repeat(40)}"`,
        hash,
      ),
    ).toMatch(/not anchored/);
    expect(
      requirementProblem(`designated => identifier "com.other" and certificate root = H"${hash}"`, hash),
    ).toMatch(/does not name/);
  });

  it.skipIf(process.platform !== 'darwin')('the CI check fails an ad-hoc signed binary', () => {
    const binary = join(work, 'adhoc');
    copyFileSync('/usr/bin/true', binary);
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', BUNDLE_ID, binary]);
    expect(() => verifyApp(binary, hash)).toThrow(/not anchored|no designated requirement/);
  });
});
