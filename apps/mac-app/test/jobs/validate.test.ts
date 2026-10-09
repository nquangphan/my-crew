import { describe, expect, it } from 'vitest';
import type { MachineJobKind } from '../../src/main/jobs/types.js';
import { machineGuardReason, validateJobPayload } from '../../src/main/jobs/validate.js';

// Bảng ca chép nguyên từ plugin crew.core (fork Paperclip, packages/crew-plugin/src/__tests__/machine-jobs-validate.test.ts):
// app kiểm lại payload đúng như server trước khi làm gì trên máy.
const fullRoles = [
  { role: 'assistant', branch: 'crew/demo/assistant' },
  { role: 'executor', branch: 'crew/demo/executor' },
  { role: 'reviewer', branch: 'crew/demo/reviewer' },
  { role: 'integrator', branch: 'crew/demo/integrator' },
];

describe('validateJobPayload', () => {
  it.each([
    ['inspect-folder', { folder: 'relative/path' }, 'folder phải là đường tuyệt đối'],
    ['inspect-folder', { folder: '/Users/a/../b' }, 'folder không được chứa ..'],
    ['inspect-folder', { folder: '/Users/a\u0007' }, 'folder có ký tự điều khiển'],
    ['inspect-folder', { folder: '/Users/a\u0000b' }, 'folder có ký tự điều khiển'],
    ['inspect-folder', { folder: `/${'a'.repeat(4096)}` }, 'folder quá dài'],
    ['inspect-folder', {}, 'folder phải là đường tuyệt đối'],
    ['inspect-folder', null, 'payload phải là object'],
    ['inspect-folder', [], 'payload phải là object'],
    ['prepare-checkouts', { projectKey: 'Bad_Key', folder: '/x', roles: [] }, 'projectKey không hợp lệ'],
    [
      'prepare-checkouts',
      { projectKey: 'demo', folder: '/x', roles: [{ role: 'executor', branch: '-x' }] },
      'branch không hợp lệ',
    ],
    [
      'prepare-checkouts',
      { projectKey: 'demo', folder: '/x', roles: [{ role: 'boss', branch: 'crew/demo/boss' }] },
      'role không hợp lệ',
    ],
    [
      'prepare-checkouts',
      { projectKey: 'demo', folder: '/x', roles: [{ role: 'executor', branch: 'a b' }] },
      'branch không hợp lệ',
    ],
    [
      'prepare-checkouts',
      { projectKey: 'demo', folder: '/x', roles: [{ role: 'executor', branch: 'x', extra: 1 }] },
      'trường extra không được hỗ trợ',
    ],
    [
      'prepare-checkouts',
      { projectKey: 'demo', folder: '/x', roles: fullRoles.slice(0, 3) },
      'roles phải có 4 hoặc 5 vai trò',
    ],
    [
      'prepare-checkouts',
      { projectKey: 'demo', folder: '/x', roles: [...fullRoles.slice(0, 3), fullRoles[0]] },
      'role assistant bị trùng',
    ],
    [
      'prepare-checkouts',
      {
        projectKey: 'demo',
        folder: '/x',
        roles: [...fullRoles.slice(1), { role: 'executor-2', branch: 'x' }],
      },
      'roles thiếu assistant',
    ],
    ['prepare-checkouts', { projectKey: 'demo', folder: '/x', roles: 'all' }, 'roles phải là mảng'],
    [
      'agent-workspace',
      { projectKey: 'demo', folder: '/x', role: 'executor', branch: '-x' },
      'branch không hợp lệ',
    ],
    [
      'agent-workspace',
      { projectKey: 'demo', folder: '/x', role: 'owner', branch: 'x' },
      'role không hợp lệ',
    ],
    ['skill-sync', { skillId: 'x', slug: 'Ok', version: '1' }, 'skillId phải là uuid'],
    [
      'skill-sync',
      { skillId: '30000000-0000-4000-8000-000000000001', slug: 'Ok', version: '1' },
      'slug không hợp lệ',
    ],
    [
      'skill-sync',
      { skillId: '30000000-0000-4000-8000-000000000001', slug: 'ok', version: '' },
      'version không hợp lệ',
    ],
    ['check', { projectKey: 'demo', extra: 1 }, 'trường extra không được hỗ trợ'],
    ['check', { projectKey: 'd' }, 'projectKey không hợp lệ'],
    ['check', { projectKey: 'demo', kind: 'inspect-folder' }, 'kind trong payload không khớp'],
    ['reboot', { projectKey: 'demo' }, 'kind không hợp lệ'],
  ])('%s từ chối %j', (kind, payload, error) => {
    expect(validateJobPayload(kind as MachineJobKind, payload)).toBe(error);
  });

  it('nhận payload hợp lệ và gắn kind', () => {
    expect(
      validateJobPayload('prepare-checkouts', {
        projectKey: 'demo',
        folder: '/Users/a/repo',
        roles: fullRoles,
      }),
    ).toEqual({ kind: 'prepare-checkouts', projectKey: 'demo', folder: '/Users/a/repo', roles: fullRoles });
    const five = [...fullRoles, { role: 'executor-2', branch: 'crew/demo/executor-2' }];
    expect(
      validateJobPayload('prepare-checkouts', { projectKey: 'demo', folder: '/Users/a/repo', roles: five }),
    ).toMatchObject({ kind: 'prepare-checkouts', roles: five });
    expect(validateJobPayload('inspect-folder', { folder: '/Users/a/my repo..bak' })).toBe(
      'folder không được chứa ..',
    );
    expect(validateJobPayload('inspect-folder', { kind: 'inspect-folder', folder: '/Users/a/repo' })).toEqual(
      {
        kind: 'inspect-folder',
        folder: '/Users/a/repo',
      },
    );
    expect(
      validateJobPayload('agent-workspace', {
        projectKey: 'demo',
        folder: '/Users/a/repo',
        role: 'executor-2',
        branch: 'crew/demo/executor-2',
      }),
    ).toEqual({
      kind: 'agent-workspace',
      projectKey: 'demo',
      folder: '/Users/a/repo',
      role: 'executor-2',
      branch: 'crew/demo/executor-2',
    });
    expect(
      validateJobPayload('skill-sync', {
        skillId: '30000000-0000-4000-8000-00000000000A',
        slug: 'superpowers',
        version: '2.1.0',
      }),
    ).toEqual({
      kind: 'skill-sync',
      skillId: '30000000-0000-4000-8000-00000000000a',
      slug: 'superpowers',
      version: '2.1.0',
    });
    expect(validateJobPayload('check', { projectKey: 'e2e-demo' })).toEqual({
      kind: 'check',
      projectKey: 'e2e-demo',
    });
  });

  it('khóa e2e-x hợp lệ', () => {
    expect(validateJobPayload('check', { projectKey: 'e2e-x' })).toEqual({
      kind: 'check',
      projectKey: 'e2e-x',
    });
  });
});

describe('machineGuardReason', () => {
  const home = '/Users/owner';
  const roles = fullRoles as { role: 'assistant'; branch: string }[];

  it('folder là gốc ổ đĩa, HOME hay cha của HOME thì bị cấm', () => {
    for (const folder of ['/', '/Users', '/Users/owner', '/Users/owner/']) {
      expect(machineGuardReason(home, { kind: 'inspect-folder', folder })).toMatch(/gốc ổ đĩa, HOME/);
    }
  });

  it('folder repo dưới ~/Documents hay /Volumes vẫn dùng được (app có Full Disk Access, như thêm project bản trước)', () => {
    expect(
      machineGuardReason(home, { kind: 'inspect-folder', folder: '/Users/owner/Documents/x' }),
    ).toBeNull();
    expect(
      machineGuardReason(home, {
        kind: 'prepare-checkouts',
        projectKey: 'demo',
        folder: '/Volumes/X/repo',
        roles,
      }),
    ).toBeNull();
  });

  it('checkout agent nằm dưới thư mục cấm (HOME đặt dưới /Volumes) thì bị cấm', () => {
    const reason = machineGuardReason('/Volumes/X/home', {
      kind: 'agent-workspace',
      projectKey: 'demo',
      folder: '/Users/a/repo',
      role: 'executor-2',
      branch: 'crew/demo/executor-2',
    });
    expect(reason).toContain('/Volumes/X/home/crew-agents/demo/executor-2');
    expect(reason).toContain('không đặt dưới /Volumes');
  });

  it('skill-sync và check không có đường dẫn để chặn', () => {
    expect(machineGuardReason(home, { kind: 'check', projectKey: 'demo' })).toBeNull();
  });
});
