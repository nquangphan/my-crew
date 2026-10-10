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

describe('validateJobPayload: gỡ checkout và xóa skill', () => {
  const PROJECT = '33333333-3333-4333-8333-333333333333';
  const SKILL = '30000000-0000-4000-8000-000000000001';
  const ok = { projectId: PROJECT, projectKey: 'demo', roles: ['executor'], removeStatusRepo: false };

  it.each([
    ['remove-checkouts', { ...ok, projectId: 'x' }, 'projectId phải là uuid'],
    ['remove-checkouts', { ...ok, projectKey: '../x' }, 'projectKey không hợp lệ'],
    ['remove-checkouts', { ...ok, projectKey: 'demo/..' }, 'projectKey không hợp lệ'],
    ['remove-checkouts', { ...ok, roles: [] }, 'roles phải có 1 đến 8 vai trò'],
    [
      'remove-checkouts',
      {
        ...ok,
        roles: [
          'assistant',
          'executor',
          'executor-2',
          'reviewer',
          'integrator',
          'executor-codex',
          'executor-opencode',
          'reviewer-codex',
          'executor',
        ],
      },
      'roles phải có 1 đến 8 vai trò',
    ],
    ['remove-checkouts', { ...ok, roles: ['executor', 'executor'] }, 'role executor bị trùng'],
    ['remove-checkouts', { ...ok, roles: ['boss'] }, 'role không hợp lệ'],
    ['remove-checkouts', { ...ok, roles: ['../executor'] }, 'role không hợp lệ'],
    ['remove-checkouts', { ...ok, roles: [{ role: 'executor' }] }, 'role không hợp lệ'],
    ['remove-checkouts', { ...ok, roles: 'executor' }, 'roles phải là mảng'],
    ['remove-checkouts', { ...ok, removeStatusRepo: 'yes' }, 'removeStatusRepo phải là boolean'],
    ['remove-checkouts', { ...ok, force: true }, 'trường force không được hỗ trợ'],
    ['remove-checkouts', { ...ok, folder: '/x' }, 'trường folder không được hỗ trợ'],
    ['skill-remove', { skillId: 'x', slug: 'ok' }, 'skillId phải là uuid'],
    ['skill-remove', { skillId: SKILL, slug: '..' }, 'slug không hợp lệ'],
    ['skill-remove', { skillId: SKILL, slug: '../workflows' }, 'slug không hợp lệ'],
    ['skill-remove', { skillId: SKILL, slug: 'a/b' }, 'slug không hợp lệ'],
    ['skill-remove', { skillId: SKILL, slug: '' }, 'slug không hợp lệ'],
    ['skill-remove', { skillId: SKILL, slug: 'a'.repeat(65) }, 'slug không hợp lệ'],
    ['skill-remove', { skillId: SKILL, slug: 'ok', version: '1' }, 'trường version không được hỗ trợ'],
  ])('%s từ chối %j', (kind, payload, error) => {
    expect(validateJobPayload(kind as MachineJobKind, payload)).toBe(error);
  });

  it('nhận payload hợp lệ và gắn kind', () => {
    expect(
      validateJobPayload('remove-checkouts', {
        ...ok,
        projectId: PROJECT.toUpperCase(),
        roles: ['assistant', 'executor', 'executor-2', 'reviewer', 'integrator'],
        removeStatusRepo: true,
      }),
    ).toEqual({
      kind: 'remove-checkouts',
      projectId: PROJECT,
      projectKey: 'demo',
      roles: ['assistant', 'executor', 'executor-2', 'reviewer', 'integrator'],
      removeStatusRepo: true,
    });
    expect(validateJobPayload('skill-remove', { kind: 'skill-remove', skillId: SKILL, slug: 'a-1' })).toEqual(
      {
        kind: 'skill-remove',
        skillId: SKILL,
        slug: 'a-1',
      },
    );
  });

  it('machineGuardReason: skill-remove không có đường dẫn; checkout gỡ dưới thư mục cấm thì bị cấm', () => {
    expect(
      machineGuardReason('/Users/owner', { kind: 'skill-remove', skillId: SKILL, slug: 'x' }),
    ).toBeNull();
    const payload = { kind: 'remove-checkouts' as const, ...ok, roles: ['executor' as const] };
    expect(machineGuardReason('/Users/owner', payload)).toBeNull();
    expect(machineGuardReason('/Volumes/X/home', payload)).toContain(
      '/Volumes/X/home/crew-agents/demo/executor',
    );
  });
});

describe('ô vai trò runtime và việc runtimes-setup', () => {
  it('nhận ba ô mới ở agent-workspace và remove-checkouts', () => {
    for (const role of ['executor-codex', 'executor-opencode', 'reviewer-codex']) {
      expect(
        validateJobPayload('agent-workspace', {
          projectKey: 'demo',
          folder: '/x',
          role,
          branch: 'crew/demo/x',
        }),
      ).toMatchObject({ role });
    }
    expect(
      validateJobPayload('remove-checkouts', {
        projectId: '33333333-3333-4333-8333-333333333333',
        projectKey: 'demo',
        roles: ['executor-codex', 'executor-opencode', 'reviewer-codex'],
        removeStatusRepo: false,
      }),
    ).toMatchObject({ roles: ['executor-codex', 'executor-opencode', 'reviewer-codex'] });
  });

  it('prepare-checkouts vẫn 4 hoặc 5 ô, thiếu ô bắt buộc thì lỗi', () => {
    const six = [...fullRoles, { role: 'executor-2', branch: 'x' }, { role: 'executor-codex', branch: 'y' }];
    expect(validateJobPayload('prepare-checkouts', { projectKey: 'demo', folder: '/x', roles: six })).toBe(
      'roles phải có 4 hoặc 5 vai trò',
    );
  });

  it('runtimes-setup: payload rỗng hợp lệ, có kind khớp cũng được, trường lạ bị từ chối', () => {
    expect(validateJobPayload('runtimes-setup', {})).toEqual({ kind: 'runtimes-setup' });
    expect(validateJobPayload('runtimes-setup', { kind: 'runtimes-setup' })).toEqual({
      kind: 'runtimes-setup',
    });
    expect(validateJobPayload('runtimes-setup', { key: 'sk-x' })).toBe('trường key không được hỗ trợ');
    expect(validateJobPayload('runtimes-setup', { kind: 'check' })).toBe('kind trong payload không khớp');
    expect(validateJobPayload('runtimes-setup', null)).toBe('payload phải là object');
  });

  it('runtimes-setup không bị chặn theo đường dẫn', () => {
    expect(machineGuardReason('/Users/a', { kind: 'runtimes-setup' })).toBeNull();
  });
});
