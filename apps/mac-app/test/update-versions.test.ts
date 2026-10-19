import { describe, expect, it } from 'vitest';
import { compareSemver, judgeCandidate, shouldOffer } from '../src/main/update/versions.js';

const arm64Files = [{ url: '2P-Crew-0.1.1-arm64-mac.zip' }, { url: '2P-Crew-0.1.1-arm64.dmg' }];

describe('compareSemver', () => {
  it('so theo số, không theo chữ', () => {
    expect(compareSemver('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compareSemver('0.2.0', '0.10.0')).toBeLessThan(0);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
  });

  it('chuỗi không phải x.y.z thì ném', () => {
    expect(() => compareSemver('0.1', '0.1.0')).toThrow();
    expect(() => compareSemver('0.1.0-beta.1', '0.1.0')).toThrow();
  });
});

describe('shouldOffer', () => {
  it('chỉ nhận bản tăng', () => {
    expect(shouldOffer({ current: '0.1.0', candidate: '0.1.1', badVersions: [] })).toBe(true);
    expect(shouldOffer({ current: '0.1.1', candidate: '0.1.1', badVersions: [] })).toBe(false);
    expect(shouldOffer({ current: '0.1.2', candidate: '0.1.1', badVersions: [] })).toBe(false);
  });

  it('bỏ bản trong badVersions, bản sau nó vẫn nhận', () => {
    expect(shouldOffer({ current: '0.1.0', candidate: '0.1.1', badVersions: ['0.1.1'] })).toBe(false);
    expect(shouldOffer({ current: '0.1.0', candidate: '0.1.2', badVersions: ['0.1.1'] })).toBe(true);
  });

  it('danh sách file phải có zip arm64', () => {
    expect(shouldOffer({ current: '0.1.0', candidate: '0.1.1', badVersions: [], files: arm64Files })).toBe(
      true,
    );
    expect(
      shouldOffer({
        current: '0.1.0',
        candidate: '0.1.1',
        badVersions: [],
        files: [{ url: '2P-Crew-0.1.1-x64-mac.zip' }, { url: '2P-Crew-0.1.1-x64.dmg' }],
      }),
    ).toBe(false);
    expect(
      shouldOffer({
        current: '0.1.0',
        candidate: '0.1.1',
        badVersions: [],
        files: [{ url: '2P-Crew-0.1.1-arm64.dmg' }],
      }),
    ).toBe(false);
  });

  it('bản prerelease hay chuỗi lạ thì không nhận', () => {
    expect(shouldOffer({ current: '0.1.0', candidate: '0.1.1-beta.1', badVersions: [] })).toBe(false);
    expect(shouldOffer({ current: '0.1.0', candidate: 'latest', badVersions: [] })).toBe(false);
  });
});

describe('judgeCandidate', () => {
  it('nêu lý do để updater ghi log đúng sự kiện', () => {
    expect(judgeCandidate({ current: '0.1.0', candidate: '0.1.1', badVersions: ['0.1.1'] })).toBe(
      'bad-version',
    );
    expect(judgeCandidate({ current: '0.1.1', candidate: '0.1.1', badVersions: [] })).toBe('not-newer');
    expect(judgeCandidate({ current: '0.1.0', candidate: '0.1.1', badVersions: [], files: [] })).toBe(
      'no-arm64',
    );
    expect(judgeCandidate({ current: '0.1.0', candidate: 'x', badVersions: [] })).toBe('invalid');
    expect(judgeCandidate({ current: '0.1.0', candidate: '0.1.1', badVersions: [] })).toBe('offer');
  });
});
