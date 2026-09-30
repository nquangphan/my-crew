import { describe, expect, it } from 'vitest';
import { detectFullDiskAccess, FULL_DISK_ACCESS_PANE, type Probe } from '../src/main/full-disk-access.js';

const errno =
  (code: string): Probe =>
  () => {
    throw Object.assign(new Error(code), { code });
  };
const reads: Probe = () => undefined;
const at = () => new Date('2026-09-30T05:00:00.000Z');

describe('Full Disk Access detection', () => {
  it('is granted when any protected path reads', () => {
    expect(detectFullDiskAccess([errno('EPERM'), reads], 'darwin', at)).toEqual({
      state: 'granted',
      checkedAt: '2026-09-30T05:00:00.000Z',
    });
  });

  it('is denied when macOS refuses the reads (EPERM or EACCES), without any prompt', () => {
    expect(detectFullDiskAccess([errno('EPERM'), errno('EACCES')], 'darwin', at).state).toBe('denied');
    expect(detectFullDiskAccess([errno('ENOENT'), errno('EPERM')], 'darwin', at).state).toBe('denied');
  });

  it('is unknown when the probed paths are missing, and unsupported off macOS', () => {
    expect(detectFullDiskAccess([errno('ENOENT'), errno('ENOTDIR')], 'darwin', at).state).toBe('unknown');
    expect(detectFullDiskAccess([reads], 'linux', at).state).toBe('unsupported');
  });

  it('opens the Full Disk Access pane of System Settings', () => {
    expect(FULL_DISK_ACCESS_PANE).toBe(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
    );
  });
});
