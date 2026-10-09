import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { BMAD_USAGE, bmadCommand } from '../src/commands/bmad.js';
import { pinDir } from '../src/workflows/pin.js';
import { FIXTURE_BMAD_PIN, fakeMac, gitIn, passThroughGitTar } from './helpers/fake-mac.js';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', 'bmad', name));
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

function setup() {
  const mac = fakeMac();
  passThroughGitTar(mac.runner);
  const root = mkdtempSync(join(tmpdir(), 'crew-bmad-cmd-'));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'epics.md'), fixture('epics-ok.md'));
  gitIn(root, 'init', '-q');
  gitIn(root, 'add', '.');
  gitIn(root, 'commit', '-q', '-m', 'init');
  const out: string[] = [];
  const err: string[] = [];
  mac.ctx.out = (l) => out.push(l);
  const run = (...argv: string[]) => bmadCommand(mac.ctx, argv, (l) => err.push(l));
  const copyPinScripts = () =>
    cpSync(
      join(pinDir(mac.home, FIXTURE_BMAD_PIN), 'skills', 'bmad', 'scripts'),
      join(root, '_bmad', 'scripts'),
      {
        recursive: true,
      },
    );
  const commit = () => {
    gitIn(root, 'add', '.');
    gitIn(root, 'commit', '-q', '-m', 'x');
    return gitIn(root, 'rev-parse', 'HEAD');
  };
  return { mac, root, out, err, run, copyPinScripts, commit };
}

describe('crew-mac bmad stories', () => {
  it('đọc file trên đĩa, --json đúng hợp đồng, không có _bmad/scripts thì scriptsMatchPin null', async () => {
    const t = setup();
    expect(await t.run('stories', '--root', t.root, '--file', 'docs/epics.md', '--json')).toBe(0);
    const json = JSON.parse(t.out.join('\n'));
    expect(Object.keys(json)).toEqual([
      'digest',
      'file',
      'rev',
      'scriptsMatchPin',
      'epics',
      'stories',
      'problems',
    ]);
    expect(json).toMatchObject({
      digest: sha256(fixture('epics-ok.md')),
      file: 'docs/epics.md',
      rev: null,
      scriptsMatchPin: null,
      problems: [],
    });
    expect(json.epics.map((e: { n: number }) => e.n)).toEqual([1, 2]);
    expect(json.stories.map((s: { key: string }) => s.key)).toEqual(['1.1', '1.2', '2.1']);
    expect(json.stories[0]).toEqual({
      key: '1.1',
      epic: 1,
      seq: 1,
      title: 'Hiện thông tin',
      body: expect.stringContaining('As a người xem'),
      acceptance: expect.any(Array),
    });
  });

  it('không --json: dòng tóm tắt', async () => {
    const t = setup();
    expect(await t.run('stories', '--root', t.root, '--file', 'docs/epics.md')).toBe(0);
    expect(t.out).toEqual([
      `crew-bmad stories file=docs/epics.md epics=2 stories=3 digest=${sha256(fixture('epics-ok.md'))} scripts=none`,
    ]);
  });

  it('_bmad/scripts trên đĩa giống bản ghim → match; khác một byte → mismatch, thoát 3', async () => {
    const t = setup();
    t.copyPinScripts();
    writeFileSync(join(t.root, '_bmad', 'scripts', '.DS_Store'), 'rác');
    mkdirSync(join(t.root, '_bmad', 'scripts', '__pycache__'));
    writeFileSync(join(t.root, '_bmad', 'scripts', '__pycache__', 'setup.cpython-312.pyc'), 'rác');
    expect(await t.run('stories', '--root', t.root, '--file', 'docs/epics.md')).toBe(0);
    expect(t.out[0]).toMatch(/ scripts=match$/);
    writeFileSync(join(t.root, '_bmad', 'scripts', 'setup.py'), 'print("setuq")\n');
    t.out.length = 0;
    expect(await t.run('stories', '--root', t.root, '--file', 'docs/epics.md', '--json')).toBe(3);
    expect(JSON.parse(t.out.join('\n')).scriptsMatchPin).toBe(false);
  });

  it('_bmad/scripts có symlink trên đĩa → mismatch', async () => {
    const t = setup();
    t.copyPinScripts();
    symlinkSync('/etc/hosts', join(t.root, '_bmad', 'scripts', 'link.py'));
    expect(await t.run('stories', '--root', t.root, '--file', 'docs/epics.md')).toBe(3);
    expect(t.out[0]).toMatch(/ scripts=mismatch$/);
  });

  it('--rev đọc nội dung ở commit, không theo đĩa; scripts theo commit', async () => {
    const t = setup();
    t.copyPinScripts();
    const good = t.commit();
    writeFileSync(join(t.root, 'docs', 'epics.md'), fixture('epics-gap.md'));
    writeFileSync(join(t.root, '_bmad', 'scripts', 'setup.py'), 'print("khác")\n');
    const bad = t.commit();
    writeFileSync(join(t.root, 'docs', 'epics.md'), '# sửa dở\n');

    expect(await t.run('stories', '--root', t.root, '--rev', good, '--file', 'docs/epics.md', '--json')).toBe(
      0,
    );
    let json = JSON.parse(t.out.join('\n'));
    expect(json).toMatchObject({
      rev: good,
      scriptsMatchPin: true,
      problems: [],
      digest: sha256(fixture('epics-ok.md')),
    });

    t.out.length = 0;
    expect(await t.run('stories', '--root', t.root, '--rev', bad, '--file', 'docs/epics.md', '--json')).toBe(
      3,
    );
    json = JSON.parse(t.out.join('\n'));
    expect(json.scriptsMatchPin).toBe(false);
    expect(json.problems).toContain('story 1.3: số thứ tự phải là 1.2');
  });

  it('--rev: commit không có _bmad/scripts → null; có file rác pycache trong commit vẫn match', async () => {
    const t = setup();
    const first = gitIn(t.root, 'rev-parse', 'HEAD');
    expect(
      await t.run('stories', '--root', t.root, '--rev', first, '--file', 'docs/epics.md', '--json'),
    ).toBe(0);
    expect(JSON.parse(t.out.join('\n')).scriptsMatchPin).toBeNull();
    t.copyPinScripts();
    mkdirSync(join(t.root, '_bmad', 'scripts', '__pycache__'));
    writeFileSync(join(t.root, '_bmad', 'scripts', '__pycache__', 'x.pyc'), 'rác');
    const second = t.commit();
    t.out.length = 0;
    expect(
      await t.run('stories', '--root', t.root, '--rev', second, '--file', 'docs/epics.md', '--json'),
    ).toBe(0);
    expect(JSON.parse(t.out.join('\n')).scriptsMatchPin).toBe(true);
  });

  it('--root là thư mục con của repo: --file và _bmad tính từ --root', async () => {
    const t = setup();
    const sub = join(t.root, 'app');
    mkdirSync(join(sub, 'docs'), { recursive: true });
    writeFileSync(join(sub, 'docs', 'epics.md'), fixture('epics-ok.md'));
    mkdirSync(join(sub, '_bmad'));
    cpSync(
      join(pinDir(t.mac.home, FIXTURE_BMAD_PIN), 'skills', 'bmad', 'scripts'),
      join(sub, '_bmad', 'scripts'),
      {
        recursive: true,
      },
    );
    const rev = t.commit();
    expect(await t.run('stories', '--root', sub, '--rev', rev, '--file', 'docs/epics.md', '--json')).toBe(0);
    expect(JSON.parse(t.out.join('\n')).scriptsMatchPin).toBe(true);
  });

  it('file lệch khuôn: thoát 3, mỗi vấn đề một dòng', async () => {
    const t = setup();
    writeFileSync(join(t.root, 'docs', 'wrong.md'), fixture('epics-wrong-epic.md'));
    writeFileSync(join(t.root, 'docs', 'no-ac.md'), fixture('epics-no-ac.md'));
    expect(await t.run('stories', '--root', t.root, '--file', 'docs/wrong.md')).toBe(3);
    expect(t.out.slice(1)).toEqual(['crew-bmad problem: story 2.1 nằm dưới Epic 1']);
    t.out.length = 0;
    expect(await t.run('stories', '--root', t.root, '--file', 'docs/no-ac.md')).toBe(3);
    expect(t.out.slice(1)).toEqual(['crew-bmad problem: story 1.2: thiếu Acceptance Criteria']);
  });

  it.each([
    [['--file', '/etc/x.md'], 'đường dẫn tương đối'],
    [['--file', '../x.md'], '..'],
    [['--file', 'docs/../x.md'], '..'],
    [['--file', 'a.txt'], '.md'],
    [['--file', 'docs/none.md'], 'không có file'],
    [['--file', 'docs/epics.md', '--rev', 'abc'], '40 hex'],
    [['--file', 'docs/epics.md', '--rev', 'a'.repeat(40)], 'không phải commit'],
    [['--file', 'docs/none.md', '--rev', 'HEAD'], '40 hex'],
  ])('đối số sai %j → thoát 2', async (args, why) => {
    const t = setup();
    expect(await t.run('stories', '--root', t.root, ...args)).toBe(2);
    expect(t.err.join('\n')).toContain(why);
    expect(t.out).toEqual([]);
  });

  it('--rev đúng commit mà file không có ở commit → thoát 2', async () => {
    const t = setup();
    writeFileSync(join(t.root, 'docs', 'new.md'), fixture('epics-ok.md'));
    const head = gitIn(t.root, 'rev-parse', 'HEAD');
    expect(await t.run('stories', '--root', t.root, '--rev', head, '--file', 'docs/new.md')).toBe(2);
    expect(t.err.join('\n')).toContain('không có file docs/new.md ở commit');
  });

  it('file là symlink hoặc trỏ ra ngoài root → thoát 2', async () => {
    const t = setup();
    const outside = mkdtempSync(join(tmpdir(), 'crew-bmad-out-'));
    writeFileSync(join(outside, 'x.md'), fixture('epics-ok.md'));
    symlinkSync(join(outside, 'x.md'), join(t.root, 'docs', 'link.md'));
    symlinkSync(outside, join(t.root, 'outdir'));
    expect(await t.run('stories', '--root', t.root, '--file', 'docs/link.md')).toBe(2);
    expect(await t.run('stories', '--root', t.root, '--file', 'outdir/x.md')).toBe(2);
  });

  it('--root không tuyệt đối, thiếu --file, cờ lạ → thoát 2 kèm cách dùng', async () => {
    const t = setup();
    expect(await t.run('stories', '--root', 'rel', '--file', 'docs/epics.md')).toBe(2);
    expect(await t.run('stories', '--root', t.root)).toBe(2);
    expect(await t.run('stories', '--root', t.root, '--file', 'docs/epics.md', '--x')).toBe(2);
    expect(await t.run('nope')).toBe(2);
    expect(t.err.at(-1)).toBe(`crew-mac: cách dùng: ${BMAD_USAGE}`);
  });
});

describe('crew-mac bmad setup-project', () => {
  it('đã có _bmad/scripts → skipped', async () => {
    const t = setup();
    mkdirSync(join(t.root, '_bmad', 'scripts'), { recursive: true });
    writeFileSync(join(t.root, '_bmad', 'scripts', 'resolve_config.py'), 'x\n');
    expect(await t.run('setup-project', '--root', t.root)).toBe(0);
    expect(t.out).toEqual(['crew-bmad setup: skipped (đã có _bmad/scripts)']);
  });

  it('dựng xong: in ok files=<n> rồi từng file', async () => {
    const t = setup();
    t.mac.runner
      .on('/bin/sh', () => ({ stdout: '/fake/uv\n' }))
      .on('/fake/uv', (args) => {
        if (args.includes('--list-config-questions')) return { stdout: '[]\n' };
        mkdirSync(join(t.root, '_bmad'), { recursive: true });
        t.copyPinScripts();
        writeFileSync(join(t.root, '_bmad', 'config.toml'), '[core]\n');
        return {};
      });
    expect(await t.run('setup-project', '--root', t.root)).toBe(0);
    expect(t.out).toEqual(['crew-bmad setup: ok files=2', '_bmad/config.toml', '_bmad/scripts/setup.py']);
  });

  it('lỗi dựng → thoát 1, một dòng crew-bmad setup: <câu>', async () => {
    const t = setup();
    t.mac.runner.on('/bin/sh', () => ({ code: 1 }));
    expect(await t.run('setup-project', '--root', t.root)).toBe(1);
    expect(t.err).toEqual(['crew-bmad setup: thiếu uv trong PATH']);
  });

  it('--root sai → thoát 2', async () => {
    const t = setup();
    expect(await t.run('setup-project', '--root', 'rel')).toBe(2);
    expect(await t.run('setup-project', '--root', join(t.root, 'none'))).toBe(2);
    expect(await t.run('setup-project')).toBe(2);
  });
});

describe('cli', () => {
  it('main chuyển lệnh bmad và usage có dòng bmad', async () => {
    const t = setup();
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(['bmad', 'stories', '--root', t.root, '--file', 'docs/epics.md'], {
      out: (l) => out.push(l),
      err: (l) => err.push(l),
      env: { HOME: t.mac.home },
      context: { runner: t.mac.runner, bmadPin: FIXTURE_BMAD_PIN },
    });
    expect(code).toBe(0);
    expect(out[0]).toMatch(/^crew-bmad stories file=docs\/epics\.md epics=2 stories=3 /);
    await main(['nope'], { out: () => {}, err: (l) => err.push(l), env: {} });
    expect(err.join('\n')).toContain(BMAD_USAGE);
  });
});
