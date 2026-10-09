import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setupProject } from '../src/bmad/setup-project.js';
import { SetupError } from '../src/context.js';
import { pinDir } from '../src/workflows/pin.js';
import { FIXTURE_BMAD_PIN, fakeMac, gitIn, passThroughGitTar } from './helpers/fake-mac.js';
import type { FakeHandler } from './helpers/fake-runner.js';

const UV = '/fake/bin/uv';

interface Question {
  module: string;
  key: string;
  prompt: string;
  default: string;
}

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'crew-bmad-proj-'));
  writeFileSync(join(dir, 'README.md'), 'repo\n');
  gitIn(dir, 'init', '-q');
  gitIn(dir, 'add', '.');
  gitIn(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

/**
 * Mac giả có `uv` giả: `--list-config-questions` trả `questions`; lệnh setup chép `skills/bmad/scripts` của bản ghim
 * vào `_bmad/scripts`, ghi `_bmad/config.toml`, rồi gọi `extra` (nếu có) để test làm hỏng kết quả.
 */
function setupMac(
  options: {
    questions?: Question[];
    uv?: boolean;
    setupResult?: { code: number; stderr?: string };
    extra?: (root: string) => void;
  } = {},
) {
  const mac = fakeMac();
  const seen: { answers: string | null; mode: number | null; path: string | null } = {
    answers: null,
    mode: null,
    path: null,
  };
  const uv: FakeHandler = (args) => {
    const root = args[args.indexOf('--project-root') + 1] as string;
    if (args.includes('--list-config-questions'))
      return { stdout: `${JSON.stringify(options.questions ?? [])}\n` };
    const at = args.indexOf('--module-answers');
    if (at >= 0) {
      const path = args[at + 1] as string;
      seen.path = path;
      seen.answers = readFileSync(path, 'utf8');
      seen.mode = statSync(path).mode & 0o777;
    }
    if (options.setupResult && options.setupResult.code !== 0) return options.setupResult;
    mkdirSync(join(root, '_bmad'), { recursive: true });
    cpSync(
      join(pinDir(mac.home, FIXTURE_BMAD_PIN), 'skills', 'bmad', 'scripts'),
      join(root, '_bmad', 'scripts'),
      {
        recursive: true,
      },
    );
    writeFileSync(join(root, '_bmad', 'config.toml'), '[core]\nproject_name = "x"\n');
    options.extra?.(root);
    return {};
  };
  passThroughGitTar(mac.runner)
    .on('/bin/sh', () => (options.uv === false ? { code: 1 } : { stdout: `${UV}\n` }))
    .on(UV, uv);
  const uvCalls = () => mac.runner.calls.filter((c) => c.command === UV);
  return { mac, seen, uvCalls };
}

describe('setupProject', () => {
  it('đã có _bmad/scripts/resolve_config.py thì skipped, không gọi uv', async () => {
    const { mac, uvCalls } = setupMac();
    const root = repo();
    mkdirSync(join(root, '_bmad', 'scripts'), { recursive: true });
    writeFileSync(join(root, '_bmad', 'scripts', 'resolve_config.py'), 'x\n');
    expect(await setupProject(mac.ctx, root)).toEqual({ status: 'skipped', files: [] });
    expect(uvCalls()).toEqual([]);
    expect(mac.runner.calls.filter((c) => c.command === '/bin/sh')).toEqual([]);
  });

  it('thiếu uv thì ném SetupError', async () => {
    const { mac, uvCalls } = setupMac({ uv: false });
    await expect(setupProject(mac.ctx, repo())).rejects.toThrow(new SetupError('thiếu uv trong PATH'));
    expect(uvCalls()).toEqual([]);
    const sh = mac.runner.calls.find((c) => c.command === '/bin/sh');
    expect(sh?.args).toEqual(['-c', 'command -v uv']);
    expect(sh?.options.env?.PATH).toContain(join(mac.home, '.local', 'bin'));
  });

  it('bản ghim chưa cài thì ném SetupError, không gọi uv', async () => {
    const { mac, uvCalls } = setupMac();
    rmSync(pinDir(mac.home, FIXTURE_BMAD_PIN), { recursive: true });
    await expect(setupProject(mac.ctx, repo())).rejects.toThrow(
      /chưa cài bản ghim BMAD 9\.9\.9-next.*crew-mac workflows install/,
    );
    expect(uvCalls()).toEqual([]);
  });

  it('bản ghim lệch checksum thì không chạy setup.py', async () => {
    const { mac, uvCalls } = setupMac();
    writeFileSync(join(pinDir(mac.home, FIXTURE_BMAD_PIN), 'skills', 'm1', 'SKILL.md'), 'sửa\n');
    await expect(setupProject(mac.ctx, repo())).rejects.toThrow(/WORKFLOW_SOURCE_MISMATCH/);
    expect(uvCalls()).toEqual([]);
  });

  it('không có câu hỏi: chạy setup.py không --module-answers, trả file mới đã sắp xếp', async () => {
    const { mac, uvCalls } = setupMac();
    const root = repo();
    const result = await setupProject(mac.ctx, root);
    expect(result).toEqual({ status: 'ok', files: ['_bmad/config.toml', '_bmad/scripts/setup.py'] });
    const skill = join(pinDir(mac.home, FIXTURE_BMAD_PIN), 'skills', 'bmad');
    expect(uvCalls().map((c) => c.args)).toEqual([
      [
        'run',
        '--no-cache',
        join(skill, 'scripts', 'setup.py'),
        '--project-root',
        root,
        '--skill',
        skill,
        '--list-config-questions',
      ],
      ['run', '--no-cache', join(skill, 'scripts', 'setup.py'), '--project-root', root, '--skill', skill],
    ]);
    for (const call of uvCalls()) {
      expect(call.options.timeoutMs).toBe(120_000);
      expect(call.options.env?.NO_COLOR).toBe('1');
    }
  });

  it('có câu hỏi: nhận default, ngôn ngữ là Vietnamese, file câu trả lời 0600 ngoài root rồi bị xóa', async () => {
    const { mac, seen } = setupMac({
      questions: [
        { module: 'bmm', key: 'planning_artifacts', prompt: 'Thư mục?', default: '{project-root}/docs/plan' },
        { module: 'bmm', key: 'document_output_language', prompt: 'Ngôn ngữ?', default: 'English' },
        { module: 'core', key: 'communication_language', prompt: 'Ngôn ngữ?', default: 'English' },
      ],
    });
    const root = repo();
    expect((await setupProject(mac.ctx, root)).status).toBe('ok');
    expect(seen.answers).toBe(
      '[modules."bmm"]\n"planning_artifacts" = "{project-root}/docs/plan"\n"document_output_language" = "Vietnamese"\n\n' +
        '[modules."core"]\n"communication_language" = "Vietnamese"\n',
    );
    expect(seen.mode).toBe(0o600);
    expect(seen.path?.startsWith(root)).toBe(false);
    expect(existsSync(seen.path as string)).toBe(false);
  });

  it('giá trị có dấu nháy và gạch chéo ngược được escape trong TOML', async () => {
    const { mac, seen } = setupMac({
      questions: [{ module: 'bmm', key: 'project_name', prompt: '?', default: 'a"b\\c' }],
    });
    await setupProject(mac.ctx, repo());
    expect(seen.answers).toBe('[modules."bmm"]\n"project_name" = "a\\"b\\\\c"\n');
  });

  it('setup.py ghi *.user.toml thì file đó bị xóa, không có trong files', async () => {
    const { mac } = setupMac({
      extra: (root) => {
        writeFileSync(join(root, '_bmad', 'config.user.toml'), '[core]\nuser_name = "q"\n');
        mkdirSync(join(root, '_bmad', 'custom'), { recursive: true });
        writeFileSync(join(root, '_bmad', 'custom', 'bmad-prd.user.toml'), 'x = "y"\n');
      },
    });
    const root = repo();
    const result = await setupProject(mac.ctx, root);
    expect(result.files).toEqual(['_bmad/config.toml', '_bmad/scripts/setup.py']);
    expect(existsSync(join(root, '_bmad', 'config.user.toml'))).toBe(false);
    expect(existsSync(join(root, '_bmad', 'custom', 'bmad-prd.user.toml'))).toBe(false);
  });

  it('script sau setup khác bản ghim thì ném SetupError', async () => {
    const { mac } = setupMac({
      extra: (root) => writeFileSync(join(root, '_bmad', 'scripts', 'setup.py'), 'print("khác")\n'),
    });
    await expect(setupProject(mac.ctx, repo())).rejects.toThrow(
      new SetupError('script _bmad sau setup khác bản ghim'),
    );
  });

  it('câu hỏi có default không đạt luật thì không chạy setup', async () => {
    const { mac, uvCalls } = setupMac({
      questions: [{ module: 'bmm', key: 'user_name', prompt: 'Tên?', default: 'Quang' }],
    });
    await expect(setupProject(mac.ctx, repo())).rejects.toThrow(
      'câu trả lời BMAD không hợp lệ: bmm.user_name: câu trả lời cá nhân không dùng cho dự án',
    );
    expect(uvCalls()).toHaveLength(1);
  });

  it('danh sách câu hỏi không phải JSON mảng thì ném SetupError', async () => {
    const { mac, uvCalls } = setupMac();
    mac.runner.on(UV, () => ({ stdout: '{"a":1}\n' }));
    await expect(setupProject(mac.ctx, repo())).rejects.toThrow(
      /danh sách câu hỏi của setup\.py không đọc được/,
    );
    expect(uvCalls()).toHaveLength(1);
  });

  it('setup.py thoát khác 0 thì ném SetupError kèm dòng lỗi cuối', async () => {
    const { mac } = setupMac({
      setupResult: { code: 1, stderr: 'Traceback (most recent call last):\nException: boom\n' },
    });
    await expect(setupProject(mac.ctx, repo())).rejects.toThrow(
      new SetupError('setup.py lỗi (mã 1): Exception: boom'),
    );
  });
});
