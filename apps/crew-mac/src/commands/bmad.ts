import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';
import { parseEpics } from '../bmad/epics.js';
import { isBmadJunk, readScriptsDir, setupProject } from '../bmad/setup-project.js';
import { type MacContext, SetupError } from '../context.js';
import { compareBmadScripts } from '../workflows/inventory.js';
import { pinDir } from '../workflows/pin.js';

export const BMAD_USAGE =
  'crew-mac bmad stories --root <dir> --file <file.md> [--rev <sha>] [--json] | setup-project --root <dir>';

const REV_RE = /^[0-9a-f]{40}$/;
const SCRIPTS = '_bmad/scripts';

/** Đối số sai: thoát 2 kèm câu cụ thể. */
class ArgError extends Error {}
/** Lỗi đọc git không do đối số: thoát 1. */
class InternalError extends Error {}

type Git = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }>;

function gitOf(ctx: MacContext, root: string): Git {
  return (args) =>
    ctx.runner.run('/usr/bin/git', ['--no-optional-locks', '-C', root, ...args], { timeoutMs: 30_000 });
}

/** `ls-tree -l` của một commit: đường dẫn (tính từ `root`) → mode và cỡ blob. */
async function lsTree(git: Git, rev: string, path: string, recursive: boolean) {
  const r = await git(['ls-tree', '-z', '-l', ...(recursive ? ['-r'] : []), rev, '--', path]);
  if (r.code !== 0 || r.timedOut)
    throw new InternalError(`git ls-tree lỗi: ${r.stderr.trim() || `mã ${r.code}`}`);
  const entries: { path: string; mode: string; size: number }[] = [];
  for (const entry of r.stdout.split('\0')) {
    const tab = entry.indexOf('\t');
    if (tab < 0) continue;
    const [mode, , , size] = entry.slice(0, tab).split(/\s+/);
    entries.push({ path: entry.slice(tab + 1), mode: mode as string, size: Number(size) });
  }
  return entries;
}

/**
 * Nội dung một blob ở commit. Runner trả chuỗi UTF-8, nên so số byte với `ls-tree -l`: lệch nghĩa là file không phải
 * UTF-8 hợp lệ và bytes đã bị đổi khi giải mã (trả null).
 */
async function showBlob(git: Git, rev: string, path: string, size: number): Promise<Buffer | null> {
  const r = await git(['show', `${rev}:./${path}`]);
  if (r.code !== 0 || r.timedOut)
    throw new InternalError(`git show lỗi: ${r.stderr.trim() || `mã ${r.code}`}`);
  const data = Buffer.from(r.stdout, 'utf8');
  return data.length === size ? data : null;
}

const isRegularBlob = (mode: string) => mode === '100644' || mode === '100755';

async function readAtRev(git: Git, rev: string, file: string): Promise<Buffer> {
  const [entry] = await lsTree(git, rev, file, false);
  if (!entry || entry.path !== file) throw new ArgError(`không có file ${file} ở commit ${rev}`);
  if (!isRegularBlob(entry.mode)) throw new ArgError(`${file} ở commit ${rev} không phải file thường`);
  const data = await showBlob(git, rev, file, entry.size);
  if (!data) throw new ArgError(`${file} ở commit ${rev} không phải văn bản UTF-8`);
  return data;
}

/** `_bmad/scripts` ở commit, null khi commit không có; `false` khi không so được byte (symlink, không phải UTF-8). */
async function scriptsAtRev(git: Git, rev: string): Promise<Map<string, Buffer> | null | false> {
  const entries = await lsTree(git, rev, SCRIPTS, true);
  if (entries.length === 0) return null;
  const files = new Map<string, Buffer>();
  for (const e of entries) {
    if (!e.path.startsWith(`${SCRIPTS}/`)) return false;
    const rel = e.path.slice(SCRIPTS.length + 1);
    if (rel.split('/').some(isBmadJunk)) continue;
    if (!isRegularBlob(e.mode)) return false;
    const data = await showBlob(git, rev, e.path, e.size);
    if (!data) return false;
    files.set(rel, data);
  }
  return files;
}

function readOnDisk(root: string, file: string): Buffer {
  const abs = join(root, file);
  let real: string;
  try {
    if (!lstatSync(abs).isFile()) throw new ArgError(`${file} không phải file thường`);
    real = realpathSync(abs);
  } catch (error) {
    if (error instanceof ArgError) throw error;
    throw new ArgError(`không có file ${file} trong ${root}`);
  }
  if (!real.startsWith(realpathSync(root) + sep)) throw new ArgError(`${file} trỏ ra ngoài ${root}`);
  return readFileSync(real);
}

function scriptsOnDisk(root: string): Map<string, Buffer> | null | false {
  const dir = join(root, '_bmad', 'scripts');
  try {
    lstatSync(dir);
  } catch {
    return null;
  }
  return readScriptsDir(dir) ?? false;
}

function parseArgs(argv: readonly string[], values: readonly string[], bools: readonly string[]) {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (values.includes(arg)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new ArgError(`${arg} cần một giá trị`);
      flags.set(arg, value);
    } else if (bools.includes(arg)) {
      flags.set(arg, true);
    } else {
      throw new ArgError(`không có tuỳ chọn ${arg}`);
    }
  }
  const value = (flag: string) => {
    const v = flags.get(flag);
    return typeof v === 'string' ? v : undefined;
  };
  return { value, has: (flag: string) => flags.has(flag) };
}

function rootOf(value: string | undefined): string {
  if (!value || !isAbsolute(value)) throw new ArgError('--root phải là đường dẫn tuyệt đối');
  try {
    if (statSync(value).isDirectory()) return value;
  } catch {}
  throw new ArgError(`--root ${value} không phải thư mục`);
}

function checkFile(file: string | undefined): string {
  if (!file) throw new ArgError('--file là bắt buộc');
  if (isAbsolute(file)) throw new ArgError('--file phải là đường dẫn tương đối trong --root');
  if (file.split(/[\\/]/).includes('..')) throw new ArgError('--file không được có ..');
  if (!file.endsWith('.md')) throw new ArgError('--file phải là file .md');
  return file.replace(/^(\.\/)+/, '');
}

async function stories(ctx: MacContext, argv: readonly string[]): Promise<number> {
  const flags = parseArgs(argv, ['--root', '--file', '--rev'], ['--json']);
  const root = rootOf(flags.value('--root'));
  const file = checkFile(flags.value('--file'));
  const rev = flags.value('--rev') ?? null;
  const git = gitOf(ctx, root);
  let data: Buffer;
  let scripts: Map<string, Buffer> | null | false;
  if (rev !== null) {
    if (!REV_RE.test(rev)) throw new ArgError('--rev phải là sha commit đủ 40 hex');
    const exists = await git(['cat-file', '-e', `${rev}^{commit}`]);
    if (exists.timedOut) throw new InternalError('git cat-file quá hạn');
    if (exists.code !== 0) throw new ArgError(`--rev ${rev} không phải commit trong repo ${root}`);
    data = await readAtRev(git, rev, file);
    scripts = await scriptsAtRev(git, rev);
  } else {
    data = readOnDisk(root, file);
    scripts = scriptsOnDisk(root);
  }
  const parsed = parseEpics(data.toString('utf8'));
  const scriptsMatchPin =
    scripts === null
      ? null
      : scripts === false
        ? false
        : compareBmadScripts(scripts, pinDir(ctx.home, ctx.bmadPin));
  const digest = createHash('sha256').update(data).digest('hex');
  if (flags.has('--json')) {
    ctx.out(JSON.stringify({ digest, file, rev, scriptsMatchPin, ...parsed }));
  } else {
    const state = scriptsMatchPin === null ? 'none' : scriptsMatchPin ? 'match' : 'mismatch';
    ctx.out(
      `crew-bmad stories file=${file} epics=${parsed.epics.length} stories=${parsed.stories.length} digest=${digest} scripts=${state}`,
    );
    for (const problem of parsed.problems) ctx.out(`crew-bmad problem: ${problem}`);
  }
  return parsed.problems.length === 0 && scriptsMatchPin !== false ? 0 : 3;
}

async function setupProjectCommand(ctx: MacContext, argv: readonly string[], err: (line: string) => void) {
  const flags = parseArgs(argv, ['--root'], []);
  const root = rootOf(flags.value('--root'));
  try {
    const result = await setupProject(ctx, root);
    if (result.status === 'skipped') {
      ctx.out('crew-bmad setup: skipped (đã có _bmad/scripts)');
    } else {
      ctx.out(`crew-bmad setup: ok files=${result.files.length}`);
      for (const f of result.files) ctx.out(f);
    }
    return 0;
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    err(`crew-bmad setup: ${error.message}`);
    return 1;
  }
}

/**
 * `crew-mac bmad <lệnh con>`. `stories`: 0 đạt, 3 file lệch khuôn hoặc `_bmad/scripts` khác bản ghim, 2 đối số sai,
 * 1 lỗi nội bộ. `setup-project`: 0 đạt, 1 lỗi dựng, 2 đối số sai.
 */
export async function bmadCommand(
  ctx: MacContext,
  argv: readonly string[],
  err: (line: string) => void = ctx.out,
): Promise<number> {
  const [sub, ...rest] = argv;
  try {
    if (sub === 'stories') return await stories(ctx, rest);
    if (sub === 'setup-project') return await setupProjectCommand(ctx, rest, err);
    err(`crew-mac: cách dùng: ${BMAD_USAGE}`);
    return 2;
  } catch (error) {
    if (error instanceof ArgError) {
      err(`crew-bmad ${sub}: ${error.message}`);
      err(`crew-mac: cách dùng: ${BMAD_USAGE}`);
      return 2;
    }
    if (error instanceof InternalError) {
      err(`crew-bmad ${sub}: ${error.message}`);
      return 1;
    }
    throw error;
  }
}
