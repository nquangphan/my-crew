import {
  type Dirent,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type MacContext, SetupError } from '../context.js';
import { checksumOrNull, pathExists } from '../workflows/install.js';
import { compareBmadScripts, recordBmadSetup } from '../workflows/inventory.js';
import { pinDir } from '../workflows/pin.js';
import { type BmadAnswer, checkBmadAnswers } from './answers.js';

/**
 * Dựng `_bmad/` cho repo dự án bằng `setup.py` của bản BMAD ghim, không tương tác: lấy câu hỏi module
 * (`--list-config-questions`), nhận đúng `default` (ngôn ngữ là `Vietnamese`), lọc qua `checkBmadAnswers`, rồi chạy
 * setup (chỉ truyền `--module-answers` khi có câu hỏi: khóa không đang chờ làm `setup.py` thoát 1). Setup thành công
 * không in gì, nên kết quả dựa vào mã thoát và `git`, không parse stdout.
 */

export interface SetupProjectResult {
  status: 'skipped' | 'ok';
  /** File mới hoặc đã đổi dưới `_bmad` (tính từ root, dấu `/`, đã sắp xếp) để agent commit. */
  files: string[];
}

const UV_TIMEOUT_MS = 120_000;
const LANGUAGE_KEYS = new Set(['communication_language', 'document_output_language']);

/** Rác của hệ điều hành và Python, không bao giờ là script BMAD. */
export function isBmadJunk(name: string): boolean {
  return (
    name === '.DS_Store' ||
    name.startsWith('._') ||
    name === 'Icon\r' ||
    name === '__pycache__' ||
    name.endsWith('.pyc')
  );
}

/**
 * Mọi file dưới `dir` (đệ quy, bỏ rác) thành bảng đường dẫn tương đối dấu `/` → nội dung, cho `compareBmadScripts`.
 * Null khi có symlink hay entry không phải file thường, hoặc không đọc được.
 */
export function readScriptsDir(dir: string): Map<string, Buffer> | null {
  const files = new Map<string, Buffer>();
  const walk = (abs: string, rel: string, depth: number): boolean => {
    if (depth > 8) return false;
    let entries: Dirent[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const e of entries) {
      if (isBmadJunk(e.name)) continue;
      const path = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (!walk(join(abs, e.name), path, depth + 1)) return false;
      } else if (e.isFile()) {
        files.set(path, readFileSync(join(abs, e.name)));
      } else {
        return false;
      }
    }
    return true;
  };
  return walk(dir, '', 0) ? files : null;
}

/** Xóa mọi `*.user.toml` dưới `dir` (không theo symlink): lớp cá nhân không dùng trong run agent. */
function removeUserToml(dir: string): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const path = join(dir, e.name);
    if (e.isDirectory()) removeUserToml(path);
    else if (e.name.endsWith('.user.toml')) rmSync(path, { force: true });
  }
}

const tomlString = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

/** `[modules."<module>"]` rồi `"<key>" = "<value>"`, giữ thứ tự câu hỏi. */
function answersToml(answers: readonly BmadAnswer[]): string {
  const byModule = new Map<string, BmadAnswer[]>();
  for (const a of answers) byModule.set(a.module, [...(byModule.get(a.module) ?? []), a]);
  return [...byModule]
    .map(
      ([module, list]) =>
        `[modules.${tomlString(module)}]\n${list.map((a) => `${tomlString(a.key)} = ${tomlString(a.value)}\n`).join('')}`,
    )
    .join('\n');
}

function parseQuestions(stdout: string): BmadAnswer[] {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    data = null;
  }
  const valid =
    Array.isArray(data) &&
    data.every(
      (q) =>
        typeof q === 'object' &&
        q !== null &&
        typeof q.module === 'string' &&
        typeof q.key === 'string' &&
        typeof q.default === 'string',
    );
  if (!valid)
    throw new SetupError(
      'danh sách câu hỏi của setup.py không đọc được (cần mảng JSON {module, key, default})',
    );
  return (data as { module: string; key: string; default: string }[]).map((q) => ({
    module: q.module,
    key: q.key,
    value: LANGUAGE_KEYS.has(q.key.split('.').at(-1) as string) ? 'Vietnamese' : q.default,
  }));
}

const lastLine = (text: string) => text.trim().split('\n').at(-1)?.trim() ?? '';

async function findUv(ctx: MacContext): Promise<string> {
  const r = await ctx.runner.run('/bin/sh', ['-c', 'command -v uv'], {
    timeoutMs: 10_000,
    env: { PATH: `${process.env.PATH ?? '/usr/bin:/bin'}:${join(ctx.home, '.local', 'bin')}` },
  });
  const path = r.stdout.trim().split('\n')[0] ?? '';
  if (r.code !== 0 || r.timedOut || !path.startsWith('/')) throw new SetupError('thiếu uv trong PATH');
  return path;
}

/** File chưa track hoặc đã đổi dưới `<root>/_bmad`, đường dẫn tính từ `root`. */
async function changedFiles(ctx: MacContext, root: string): Promise<string[]> {
  const r = await ctx.runner.run(
    '/usr/bin/git',
    [
      '--no-optional-locks',
      '-C',
      root,
      'ls-files',
      '-z',
      '--others',
      '--modified',
      '--exclude-standard',
      '--',
      '_bmad',
    ],
    { timeoutMs: 10_000 },
  );
  if (r.code !== 0 || r.timedOut)
    throw new SetupError(`không đọc được git của ${root}: ${lastLine(r.stderr) || `mã ${r.code}`}`);
  return [...new Set(r.stdout.split('\0').filter((p) => p.length > 0))].sort();
}

export async function setupProject(ctx: MacContext, root: string): Promise<SetupProjectResult> {
  if (existsSync(join(root, '_bmad', 'scripts', 'resolve_config.py')))
    return { status: 'skipped', files: [] };
  const pin = ctx.bmadPin;
  const dir = pinDir(ctx.home, pin);
  if (!pathExists(dir))
    throw new SetupError(`chưa cài bản ghim BMAD ${pin.version} (${dir}); chạy "crew-mac workflows install"`);
  if (checksumOrNull(dir) !== pin.checksum)
    throw new SetupError(
      `${dir} lệch checksum so với bản ghim BMAD ${pin.version} (WORKFLOW_SOURCE_MISMATCH); ` +
        'xóa thư mục đó rồi chạy lại "crew-mac workflows install".',
    );
  const uv = await findUv(ctx);
  const skill = join(dir, 'skills', 'bmad');
  const base = [
    'run',
    '--no-cache',
    join(skill, 'scripts', 'setup.py'),
    '--project-root',
    root,
    '--skill',
    skill,
  ];
  const opts = { timeoutMs: UV_TIMEOUT_MS, env: { NO_COLOR: '1' } };
  const fail = (r: { code: number; stderr: string; timedOut: boolean }) =>
    new SetupError(
      r.timedOut
        ? `setup.py quá hạn ${UV_TIMEOUT_MS / 1000} giây`
        : `setup.py lỗi (mã ${r.code})${lastLine(r.stderr) ? `: ${lastLine(r.stderr)}` : ''}`,
    );

  const list = await ctx.runner.run(uv, [...base, '--list-config-questions'], opts);
  if (list.code !== 0 || list.timedOut) throw fail(list);
  const answers = parseQuestions(list.stdout);
  const problems = checkBmadAnswers(answers, { allowLanguage: true });
  if (problems.length > 0) throw new SetupError(`câu trả lời BMAD không hợp lệ: ${problems[0]}`);

  let tmp: string | null = null;
  try {
    const args = [...base];
    if (answers.length > 0) {
      tmp = mkdtempSync(join(tmpdir(), 'crew-bmad-answers-'));
      const file = join(tmp, 'answers.toml');
      writeFileSync(file, answersToml(answers), { mode: 0o600 });
      args.push('--module-answers', file);
    }
    const r = await ctx.runner.run(uv, args, opts);
    if (r.code !== 0 || r.timedOut) throw fail(r);
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }

  removeUserToml(join(root, '_bmad'));
  const scripts = readScriptsDir(join(root, '_bmad', 'scripts'));
  if (!scripts || !compareBmadScripts(scripts, dir))
    throw new SetupError('script _bmad sau setup khác bản ghim');
  // Run bị ngắt trước khi commit thì run sau vẫn qua `workflow-check` với đúng `config.toml` vừa ghi.
  recordBmadSetup(ctx.home, root);
  return { status: 'ok', files: await changedFiles(ctx, root) };
}
