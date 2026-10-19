import { chmodSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cleanMessage } from '../src/commands/check.js';
import { addedLines, scanBuiltIn, scanPatch } from '../src/secret-scan.js';
import {
  DOCS_INIT_TRAILER,
  emptyRepo,
  fakeAwsKey,
  fixtureRepo,
  runCli,
  type TestRepo,
  tempDir,
} from './helpers/git-repo.js';

const APPROVED = 'Crew-Owner-Approved: WEB-12';

/** Lines of `out` that are violations of one rule. */
const lines = (out: string, rule?: string) =>
  out.split('\n').filter((line) => (rule ? line.startsWith(`${rule} `) : /^R\d /.test(line)));

async function range(repo: TestRepo, base: string) {
  return repo.cli('check', '--range', `${base}..HEAD`);
}

describe('fixture baseline', () => {
  it('passes --all, --staged and a range that starts with the docs-init commit', async () => {
    const repo = await fixtureRepo();
    expect(await repo.cli('check', '--all')).toMatchObject({ code: 0 });
    expect(await repo.cli('check', '--staged')).toMatchObject({ code: 0 });
    const root = repo.git('rev-list', '--max-parents=0', 'HEAD').trim();
    repo.write('src/checkout/cart.ts', 'export const addItem = (item: string) => [item, item];\n');
    repo.append('docs/flows/checkout.md', '\nGiỏ hàng nhân đôi món.\n');
    repo.commit('feat: nhân đôi món');
    const all = await repo.cli('check', '--range', `${root}..HEAD`);
    expect(all).toMatchObject({ code: 0 });
    expect(all.err).toContain('ok (1 commits)');
  });
});

describe('R1 manifest', () => {
  it('fails on invalid YAML, duplicate flow ids, missing files, unknown shared flows and bad doc paths', async () => {
    const repo = await fixtureRepo();
    const manifest = repo.read('docs/flows.yaml');

    repo.write('docs/flows.yaml', 'version: 1\nflows: [\n');
    let res = await repo.cli('check', '--all');
    expect(res.code).toBe(1);
    expect(lines(res.out, 'R1')[0]).toMatch(/^R1 docs\/flows\.yaml: invalid YAML/);

    repo.write(
      'docs/flows.yaml',
      manifest
        .replace('shared:', 'flows2: {}\nshared:')
        .replace(
          '  payments:\n',
          '  checkout:\n    title: Trùng\n    doc: docs/flows/checkout.md\n  payments:\n',
        ),
    );
    res = await repo.cli('check', '--all');
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/R1 docs\/flows\.yaml: invalid YAML: Map keys must be unique/);

    repo.write(
      'docs/flows.yaml',
      manifest
        .replace('files: [src/checkout/cart.ts]', 'files: [src/checkout/cart.ts, src/checkout/gone.ts]')
        .replace('src/db.ts: [checkout, payments]', 'src/db.ts: [checkout, refunds]')
        .replace('doc: docs/flows/payments.md', 'doc: notes/payments.txt'),
    );
    res = await repo.cli('check', '--all');
    expect(res.code).toBe(1);
    const r1 = lines(res.out, 'R1');
    expect(r1).toContainEqual(
      expect.stringMatching(/^R1 src\/checkout\/gone\.ts: file of flow checkout is listed/),
    );
    expect(r1).toContainEqual(
      expect.stringMatching(/^R1 src\/db\.ts: shared entry names unknown flow refunds/),
    );
    expect(r1).toContainEqual(
      expect.stringMatching(/^R1 notes\/payments\.txt: doc of flow payments must be/),
    );
  });
});

describe('R2 coverage', () => {
  it('fails a new unmapped source file in --all but not at commit time, and passes once it is mapped', async () => {
    const repo = await fixtureRepo();
    repo.write('src/checkout/coupon.ts', 'export const coupon = 1;\n');
    const res = await repo.cli('check', '--all');
    expect(res.code).toBe(1);
    expect(lines(res.out)).toEqual([
      expect.stringMatching(/^R2 src\/checkout\/coupon\.ts: source file is in no flow/),
    ]);

    repo.git('add', '-A');
    expect(await repo.cli('check', '--staged')).toMatchObject({ code: 0, out: '' });

    repo.write(
      'docs/flows.yaml',
      repo
        .read('docs/flows.yaml')
        .replace('files: [src/checkout/cart.ts]', 'files: [src/checkout/cart.ts, src/checkout/coupon.ts]'),
    );
    expect((await repo.cli('generate')).code).toBe(0);
    repo.append('docs/flows/checkout.md', '\nMã giảm giá: `src/checkout/coupon.ts`.\n');
    repo.git('add', '-A');
    expect(await repo.cli('check', '--staged')).toMatchObject({ code: 0 });
    expect(await repo.cli('check', '--all')).toMatchObject({ code: 0 });
  });

  it('ignores excluded files and files outside source.include', async () => {
    const repo = await fixtureRepo();
    repo.write('src/checkout/cart.test.ts', 'export {};\n').write('scripts/tool.sh', 'echo\n');
    expect(await repo.cli('check', '--all')).toMatchObject({ code: 0 });
  });
});

describe('R3 freshness', () => {
  it('lets the commit through, blocks the range naming the doc, and passes once the doc is edited', async () => {
    const repo = await fixtureRepo();
    const base = repo.head();
    repo.write('src/checkout/cart.ts', 'export const addItem = (item: string) => [item.trim()];\n');
    repo.git('add', '-A');
    expect(await repo.cli('check', '--staged')).toMatchObject({ code: 0 });
    const head = repo.commit('feat: cắt khoảng trắng');
    let res = await range(repo, base);
    expect(res.code).toBe(1);
    expect(lines(res.out)).toEqual([
      `R3 src/checkout/cart.ts: changed without updating docs/flows/checkout.md (flow checkout); edit that flow doc in a commit of the same push [commit ${head.slice(0, 7)}]`,
    ]);

    repo.append('docs/flows/checkout.md', '\nTên món được cắt khoảng trắng.\n');
    repo.commit('docs: cập nhật checkout');
    res = await range(repo, base);
    expect(res).toMatchObject({ code: 0 });
  });

  it('checks renames against the flows before and after', async () => {
    const repo = await fixtureRepo();
    const base = repo.head();
    repo.git('mv', 'src/checkout/cart.ts', 'src/checkout/basket.ts');
    repo.write(
      'docs/flows.yaml',
      repo.read('docs/flows.yaml').replace('src/checkout/cart.ts', 'src/checkout/basket.ts'),
    );
    await repo.cli('generate');
    repo.commit('refactor: đổi tên giỏ hàng');
    let res = await range(repo, base);
    expect(res.code).toBe(1);
    expect(lines(res.out, 'R3').map((line) => line.split(':')[0])).toEqual([
      'R3 src/checkout/cart.ts',
      'R3 src/checkout/basket.ts',
    ]);

    repo.append('docs/flows/checkout.md', '\n`src/checkout/basket.ts` thay cho cart.ts.\n');
    repo.git('add', '-A');
    repo.git('commit', '--no-verify', '-q', '--amend', '--no-edit');
    res = await range(repo, base);
    expect(res).toMatchObject({ code: 0 });
  });

  it('requires the doc of the flow a deleted file belonged to', async () => {
    const repo = await fixtureRepo();
    const base = repo.head();
    repo.git('rm', '-q', 'src/payments/charge.ts');
    repo.write(
      'docs/flows.yaml',
      repo.read('docs/flows.yaml').replace('files: [src/payments/charge.ts]', 'files: []'),
    );
    await repo.cli('generate');
    repo.commit('chore: bỏ charge');
    let res = await range(repo, base);
    expect(lines(res.out, 'R3')).toEqual([
      expect.stringContaining('R3 src/payments/charge.ts: changed without updating docs/flows/payments.md'),
    ]);

    repo.append('docs/flows/payments.md', '\nĐã bỏ bước charge.\n');
    repo.git('add', '-A');
    repo.git('commit', '--no-verify', '-q', '--amend', '--no-edit');
    res = await range(repo, base);
    expect(res).toMatchObject({ code: 0 });
  });

  it('requires every flow a shared file lists, and nothing for an unassigned file', async () => {
    const repo = await fixtureRepo();
    const base = repo.head();
    repo.write('src/db.ts', "export const db = { url: 'postgres' };\n");
    repo.append('docs/flows/checkout.md', '\nDùng Postgres.\n');
    const head = repo.commit('feat: postgres');
    let res = await range(repo, base);
    expect(lines(res.out)).toEqual([
      `R3 src/db.ts: changed without updating docs/flows/payments.md (flow payments); edit that flow doc in a commit of the same push [commit ${head.slice(0, 7)}]`,
    ]);
    repo.append('docs/flows/payments.md', '\nDùng Postgres.\n');
    repo.commit('docs: payments dùng Postgres');
    expect(await range(repo, base)).toMatchObject({ code: 0 });

    const next = repo.head();
    repo.write('src/dev-reset.ts', 'export const reset = () => null;\n');
    repo.commit('chore: reset');
    res = await range(repo, next);
    expect(res).toMatchObject({ code: 0 });
  });

  it('accepts a doc edited in a later commit of the range, and reports a missing doc on the range head', async () => {
    const repo = await fixtureRepo();
    const base = repo.head();
    repo.write('src/checkout/cart.ts', 'export const addItem = (item: string) => [item, 1];\n');
    repo.append('docs/flows/checkout.md', '\nThêm số lượng.\n');
    repo.commit('feat: số lượng');
    repo.write('src/payments/charge.ts', 'export const charge = (amount: number) => amount >= 0;\n');
    repo.commit('fix: cho phép 0 đồng');
    repo.write(
      'src/checkout/routes.ts',
      "import { addItem } from './cart';\n\nexport const checkoutRoute = (item: string) => addItem(item.trim());\n",
    );
    const head = repo.commit('feat: route cắt khoảng trắng');

    let res = await range(repo, base);
    expect(res.code).toBe(1);
    expect(lines(res.out)).toEqual([
      `R3 src/payments/charge.ts: changed without updating docs/flows/payments.md (flow payments); edit that flow doc in a commit of the same push [commit ${head.slice(0, 7)}]`,
    ]);
    expect(res.err).toContain('(3 commits)');

    repo.append('docs/flows/payments.md', '\nCho phép 0 đồng.\n');
    repo.commit('docs: payments');
    res = await range(repo, base);
    expect(res).toMatchObject({ code: 0 });
  });

  it('skips merge commits because their parents are checked', async () => {
    const repo = await fixtureRepo();
    const base = repo.head();
    repo.git('checkout', '-q', '-b', 'feature');
    repo.write('src/checkout/cart.ts', 'export const addItem = (item: string) => [item, 2];\n');
    repo.append('docs/flows/checkout.md', '\nNhánh feature.\n');
    repo.commit('feat: nhánh');
    repo.git('checkout', '-q', 'main');
    repo.write('src/payments/charge.ts', 'export const charge = (amount: number) => amount > 1;\n');
    repo.append('docs/flows/payments.md', '\nNhánh main.\n');
    repo.commit('feat: main');
    repo.git('merge', '-q', '--no-ff', '--no-verify', '-m', 'Merge feature', 'feature');
    expect(repo.git('rev-list', '--merges', '--count', `${base}..HEAD`).trim()).toBe('1');

    const res = await range(repo, base);
    expect(res).toMatchObject({ code: 0 });
    expect(res.err).toContain('(2 commits)');
  });
});

describe('docs-init commit', () => {
  async function preInitRepo() {
    const repo = emptyRepo();
    repo.write('src/app.ts', 'export const app = 1;\n');
    const first = repo.commit('feat: app');
    return { repo, first };
  }

  async function writeInitDocs(repo: TestRepo) {
    expect((await repo.cli('init')).code).toBe(0);
    repo.write(
      'docs/flows.yaml',
      'version: 1\nsource:\n  include: ["src/**"]\nflows:\n  app:\n    title: Ứng dụng\n    doc: docs/flows/app.md\n    files: [src/app.ts]\n',
    );
    expect((await repo.cli('init', '--flow', 'app', '--title', 'Ứng dụng')).code).toBe(0);
    expect((await repo.cli('generate')).code).toBe(0);
    repo.write('src/app.ts', 'export const app = 2;\n');
  }

  it('is exempt from R3 and R6 with the trailer, and fails R6 without it', async () => {
    const { repo, first } = await preInitRepo();
    await writeInitDocs(repo);
    repo.git('add', '-A');
    expect(await repo.cli('check', '--staged')).toMatchObject({ code: 0 });

    const msgFile = `${tempDir('crew-docs-msg-')}/COMMIT_EDITMSG`;
    writeFileSync(msgFile, 'docs: init\n');
    let res = await repo.cli('check', '--commit-msg', msgFile);
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/R6 docs\/flows\.yaml: protected section\(s\) source changed/);
    expect(res.out).toMatch(/R6 CLAUDE\.md: protected path changed/);
    expect(res.out).toMatch(/R6 AGENTS\.md: protected path changed/);
    writeFileSync(msgFile, `docs: init\n\n${DOCS_INIT_TRAILER}\n# Please enter the commit message\n`);
    expect(await repo.cli('check', '--commit-msg', msgFile)).toMatchObject({ code: 0 });

    repo.git('add', '-A');
    repo.git('commit', '--no-verify', '-q', '-F', msgFile);
    expect(await range(repo, first)).toMatchObject({ code: 0 });

    repo.git('commit', '--no-verify', '-q', '--amend', '-m', 'docs: init without trailer');
    res = await range(repo, first);
    expect(res.code).toBe(1);
    expect(lines(res.out, 'R6').length).toBeGreaterThan(0);
  });

  it('is still recognised after a squash that buries the trailer mid-message', async () => {
    const { repo, first } = await preInitRepo();
    await writeInitDocs(repo);
    repo.commit(`docs: init\n\n${DOCS_INIT_TRAILER}`);
    repo.write('src/app.ts', 'export const app = 3;\n');
    repo.append('docs/flows/app.md', '\nPhiên bản 3.\n');
    repo.commit('feat: app 3');

    repo.git('reset', '--soft', first);
    repo.git(
      'commit',
      '--no-verify',
      '-q',
      '-m',
      `squash: docs init và app 3\n\n# This is the 1st commit message:\n\ndocs: init\n\n${DOCS_INIT_TRAILER}\n\n# This is the commit message #2:\n\nfeat: app 3`,
    );
    const res = await range(repo, first);
    expect(res).toMatchObject({ code: 0 });
    expect(res.err).toContain('(1 commits)');
  });

  it('skips history from before the docs existed', async () => {
    const { repo } = await preInitRepo();
    repo.write('src/app.ts', 'export const app = 5;\n');
    repo.commit('feat: trước docs');
    await writeInitDocs(repo);
    repo.commit(`docs: init\n\n${DOCS_INIT_TRAILER}`);
    const root = repo.git('rev-list', '--max-parents=0', 'HEAD').trim();
    const res = await repo.cli('check', '--range', `${root}..HEAD`);
    expect(res).toMatchObject({ code: 0 });
  });
});

describe('R4 generated blocks', () => {
  it('fails when index.md or files.md drift from generate, and passes after generate', async () => {
    const repo = await fixtureRepo();
    repo.write(
      'docs/flows.yaml',
      repo.read('docs/flows.yaml').replace('tests: [test/cart.test.ts]', 'tests: []'),
    );
    let res = await repo.cli('check', '--all');
    expect(lines(res.out)).toEqual([
      expect.stringMatching(
        /^R4 docs\/files\.md: generated "files" block is out of date; run `crew-docs generate`/,
      ),
    ]);
    repo.write('docs/index.md', '# Tổng quan\n');
    res = await repo.cli('check', '--all');
    expect(lines(res.out, 'R4')).toHaveLength(2);
    expect((await repo.cli('generate')).out).toContain('updated docs/index.md');
    expect(await repo.cli('check', '--all')).toMatchObject({ code: 0 });
    expect((await repo.cli('generate')).out).toContain('unchanged docs/index.md');
    expect(repo.read('docs/files.md')).toContain(
      '| `src/db.ts` | [checkout](flows/checkout.md) (dùng chung), [payments](flows/payments.md) (dùng chung) |',
    );
    expect(repo.read('docs/index.md')).toContain('| [Thanh toán](flows/payments.md) | `payments` | — |');
  });
});

describe('R5 initialized', () => {
  it('exits 3 NOT_INITIALIZED without docs/flows.yaml in --all and --range', async () => {
    const repo = emptyRepo();
    repo.write('src/app.ts', 'export {};\n');
    const first = repo.commit('feat: app');
    repo.write('src/app.ts', 'export const a = 1;\n');
    repo.commit('feat: a');
    for (const args of [['--all'], ['--range', `${first}..HEAD`]]) {
      const res = await repo.cli('check', ...args);
      expect(res.code, args.join(' ')).toBe(3);
      expect(res.out).toMatch(/^R5 docs\/flows\.yaml: NOT_INITIALIZED/);
    }
  });

  it('lets the hook modes pass with a one-line warning in a repo that has not adopted the standard', async () => {
    const repo = emptyRepo();
    repo.write('src/app.ts', 'export {};\n');
    const first = repo.commit('feat: app');
    repo.write('src/app.ts', `export const key = '${fakeAwsKey()}';\n`);
    repo.git('add', '-A');
    repo.write('.git/COMMIT_EDITMSG', 'chore: đổi app\n');
    const staged = await repo.cli('check', '--staged');
    const message = await repo.cli('check', '--commit-msg', '.git/COMMIT_EDITMSG');
    repo.git('commit', '--no-verify', '-q', '-m', 'chore: đổi app');
    const push = await runCli(
      repo.root,
      ['check', '--pre-push'],
      `refs/heads/main ${repo.head()} refs/heads/main ${first}\n`,
    );
    for (const res of [staged, message, push]) {
      expect(res).toMatchObject({ code: 0, out: '' });
      expect(res.err).toMatch(/cảnh báo: repo chưa có docs\/flows\.yaml/);
      expect(res.err.split('\n')).toHaveLength(1);
    }
  });

  it('keeps refusing a commit or push that removes the manifest of an adopted repo', async () => {
    const repo = await fixtureRepo();
    const adopted = repo.head();
    repo.git('rm', '-q', 'docs/flows.yaml');
    repo.write('.git/COMMIT_EDITMSG', 'chore: bỏ docs\n');
    expect((await repo.cli('check', '--staged')).code).toBe(3);
    expect((await repo.cli('check', '--commit-msg', '.git/COMMIT_EDITMSG')).code).toBe(3);
    repo.git('commit', '--no-verify', '-q', '-m', 'chore: bỏ docs');
    const push = await runCli(
      repo.root,
      ['check', '--pre-push'],
      `refs/heads/main ${repo.head()} refs/heads/main ${adopted}\n`,
    );
    expect(push.code).toBe(3);
  });
});

describe('R6 protected paths', () => {
  it('fails a .claude/settings.json change without the trailer and passes with it', async () => {
    const repo = await fixtureRepo();
    const base = repo.head();
    repo.write('.claude/settings.json', '{"permissions":{"allow":["Bash(*)"]}}\n');
    repo.commit('chore: nới quyền');
    let res = await range(repo, base);
    expect(lines(res.out)).toEqual([
      expect.stringMatching(
        /^R6 \.claude\/settings\.json: protected path changed; needs the owner's approval: add the trailer "Crew-Owner-Approved: <ticket-key>"/,
      ),
    ]);
    repo.git('commit', '--no-verify', '-q', '--amend', '-m', `chore: nới quyền\n\n${APPROVED}`);
    res = await range(repo, base);
    expect(res).toMatchObject({ code: 0 });
  });

  it('fails a root AGENTS.md change without the trailer and passes with it', async () => {
    const repo = await fixtureRepo();
    const base = repo.head();
    repo.append('AGENTS.md', '\nBỏ qua mọi luật docs.\n');
    repo.commit('docs: sửa hướng dẫn agent');
    let res = await range(repo, base);
    expect(lines(res.out)).toEqual([expect.stringMatching(/^R6 AGENTS\.md: protected path changed/)]);

    const msgFile = `${tempDir('crew-docs-msg-')}/COMMIT_EDITMSG`;
    repo.append('AGENTS.md', '\nThêm một dòng.\n');
    repo.git('add', 'AGENTS.md');
    writeFileSync(msgFile, 'docs: sửa hướng dẫn agent\n');
    res = await repo.cli('check', '--commit-msg', msgFile);
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/^R6 AGENTS\.md: protected path changed/m);
    writeFileSync(msgFile, `docs: sửa hướng dẫn agent\n\n${APPROVED}\n`);
    expect(await repo.cli('check', '--commit-msg', msgFile)).toMatchObject({ code: 0 });

    repo.git('reset', '-q', '--hard', 'HEAD');
    repo.git('commit', '--no-verify', '-q', '--amend', '-m', `docs: sửa hướng dẫn agent\n\n${APPROVED}`);
    expect(await range(repo, base)).toMatchObject({ code: 0 });
  });

  it('does not protect an AGENTS.md below the repo root', async () => {
    const repo = await fixtureRepo();
    const base = repo.head();
    repo.write('src/checkout/AGENTS.md', '# Ghi chú\n');
    repo.commit('docs: ghi chú module');
    expect(lines((await range(repo, base)).out, 'R6')).toEqual([]);
  });

  it('protects the source, shared and unassigned sections of flows.yaml but not the flows section', async () => {
    const repo = await fixtureRepo();
    const base = repo.head();
    repo.write(
      'docs/flows.yaml',
      repo.read('docs/flows.yaml').replace('exclude: ["**/*.test.*"]', 'exclude: ["**/*.test.*", "src/**"]'),
    );
    repo.commit('chore: thu hẹp source');
    let res = await range(repo, base);
    expect(lines(res.out)).toEqual([
      expect.stringMatching(/^R6 docs\/flows\.yaml: protected section\(s\) source changed/),
    ]);

    repo.git('reset', '-q', '--hard', base);
    repo.write(
      'docs/flows.yaml',
      repo.read('docs/flows.yaml').replace('tests: [test/cart.test.ts]', 'tests: []'),
    );
    await repo.cli('generate');
    repo.commit('docs: bỏ test khỏi flow');
    res = await range(repo, base);
    expect(res).toMatchObject({ code: 0 });
  });
});

describe('R7 secrets', () => {
  it('fails a staged fake AWS key at commit time and in a pushed range', async () => {
    const repo = await fixtureRepo();
    const base = repo.head();
    repo.write('src/dev-reset.ts', `export const key = '${fakeAwsKey()}';\n`);
    repo.git('add', '-A');
    let res = await repo.cli('check', '--staged');
    expect(lines(res.out)).toEqual([
      expect.stringMatching(/^R7 src\/dev-reset\.ts: line 1 looks like a credential \(aws-access-key-id\)/),
    ]);
    repo.commit('chore: lỡ tay');
    res = await range(repo, base);
    expect(lines(res.out, 'R7')).toHaveLength(1);
  });

  it('parses added lines with their line numbers and ignores documented example keys', () => {
    const patch = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -3,0 +4,2 @@',
      '+const a = 1;',
      `+const k = '${fakeAwsKey()}';`,
      'diff --git a/gone.ts b/gone.ts',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      `-const old = '${fakeAwsKey()}';`,
    ].join('\n');
    expect(addedLines(patch)).toEqual([
      { path: 'a.ts', line: 4, text: 'const a = 1;' },
      { path: 'a.ts', line: 5, text: `const k = '${fakeAwsKey()}';` },
    ]);
    expect(scanPatch(patch, null).findings).toEqual([{ rule: 'aws-access-key-id', path: 'a.ts', line: 5 }]);
    const example = ['AKIA', 'IOSFODNN7', 'EXAMPLE'].join('');
    expect(scanBuiltIn([{ path: 'x', line: 1, text: example }])).toEqual([]);
    const pem = ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ');
    const crew = `crew_mt_${'x'.repeat(43)}`;
    expect(
      scanBuiltIn([
        { path: 'x', line: 1, text: pem },
        { path: 'y', line: 2, text: crew },
      ]).map((f) => f.rule),
    ).toEqual(['private-key', 'crew-machine-token']);
  });

  it('adds gitleaks findings when a gitleaks binary is available', async () => {
    const dir = tempDir('crew-docs-gitleaks-bin-');
    const fake = `${dir}/gitleaks`;
    // Stands in for the gitleaks CLI contract: `stdin ... --report-path <file>` writes a JSON findings list.
    writeFileSync(
      fake,
      '#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ "$1" = "--report-path" ]; then out="$2"; fi; shift; done\ncat >/dev/null\necho \'[{"RuleID":"generic-api-key","StartLine":2}]\' > "$out"\n',
    );
    chmodSync(fake, 0o755);
    const patch = '+++ b/cfg.ts\n@@ -0,0 +1,2 @@\n+const a = 1;\n+const token = "q8Zr2mVx";\n';
    const result = scanPatch(patch, fake);
    expect(result.engines).toEqual(['built-in', 'gitleaks']);
    expect(result.findings).toEqual([{ rule: 'gitleaks:generic-api-key', path: 'cfg.ts', line: 2 }]);
  });
});

describe('lookups', () => {
  it('where prints the owning flows, the unassigned reason, or R2 for an unmapped source file', async () => {
    const repo = await fixtureRepo();
    let res = await repo.cli('where', 'src/db.ts');
    expect(res).toMatchObject({ code: 0 });
    expect(res.out.split('\n')).toEqual([
      'checkout\tshared\tdocs/flows/checkout.md\tĐặt hàng',
      'payments\tshared\tdocs/flows/payments.md\tThanh toán',
    ]);
    res = await runCli(`${repo.root}/src/checkout`, ['where', 'routes.ts']);
    expect(res.out).toBe('checkout\tentrypoint\tdocs/flows/checkout.md\tĐặt hàng');
    res = await repo.cli('where', 'src/dev-reset.ts');
    expect(res.out).toBe('unassigned\tcông cụ dev cục bộ, không thuộc flow nào');
    repo.write('src/new.ts', 'export {};\n');
    res = await repo.cli('where', 'src/new.ts');
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/^R2 src\/new\.ts/);
    expect((await repo.cli('where', '../outside.ts')).code).toBe(2);
  });

  it('flow prints the exact files of a flow', async () => {
    const repo = await fixtureRepo();
    const res = await repo.cli('flow', 'checkout');
    expect(res.code).toBe(0);
    expect(res.out).toBe(
      [
        'flow: checkout',
        'title: Đặt hàng',
        'doc: docs/flows/checkout.md',
        'entrypoints:',
        '  - src/checkout/routes.ts',
        'files:',
        '  - src/checkout/cart.ts',
        'tests:',
        '  - test/cart.test.ts',
        'shared:',
        '  - src/db.ts',
      ].join('\n'),
    );
    const unknown = await repo.cli('flow', 'refunds');
    expect(unknown.code).toBe(1);
    expect(unknown.out).toContain('known flows: checkout, payments');
  });
});

describe('init and CLI surface', () => {
  it('scaffolds without overwriting, prints the checklist, and refuses an existing flow doc', async () => {
    const repo = emptyRepo();
    repo.write('AGENTS.md', '# Của tôi\n');
    const res = await repo.cli('init');
    expect(res.code).toBe(0);
    expect(res.out).toContain('kept AGENTS.md');
    expect(res.out).toContain('created docs/flows.yaml');
    expect(res.out).toContain('Crew-Docs-Init: true');
    expect(repo.read('AGENTS.md')).toBe('# Của tôi\n');
    expect(repo.read('CLAUDE.md')).toBe('@AGENTS.md\n');
    expect(await repo.cli('check', '--all')).toMatchObject({ code: 0 });
    expect((await repo.cli('init', '--flow', 'checkout', '--title', 'Đặt hàng')).code).toBe(0);
    expect(repo.read('docs/flows/checkout.md')).toMatch(/^# Đặt hàng\n/);
    expect(repo.read('docs/flows/checkout.md')).toContain('## Mục đích');
    expect((await repo.cli('init', '--flow', 'checkout')).code).toBe(2);
    expect((await repo.cli('init', '--flow', 'Bad_Id')).code).toBe(2);
  });

  it('rejects bad usage with exit 2', async () => {
    const repo = await fixtureRepo();
    expect((await repo.cli('check')).code).toBe(2);
    expect((await repo.cli('check', '--staged', '--all')).code).toBe(2);
    expect((await repo.cli('check', '--range', 'nope..HEAD')).code).toBe(2);
    expect((await repo.cli('check', '--range', 'HEAD')).code).toBe(2);
    expect((await repo.cli('frobnicate')).code).toBe(2);
    expect((await runCli(tempDir('crew-docs-nogit-'), ['check', '--all'])).code).toBe(2);
  });

  it('strips comments and the scissors section from commit messages', () => {
    expect(
      cleanMessage(
        'a\n# comment\nb\n# ------------------------ >8 ------------------------\nCrew-Docs-Init: true\n',
      ),
    ).toBe('a\nb');
  });
});
