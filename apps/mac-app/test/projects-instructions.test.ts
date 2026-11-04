import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PaperclipClient } from '../src/main/paperclip/types.js';
import {
  pinnedExtraArgs,
  ROLE_TEMPLATES,
  renderInstructions,
  uploadInstructions,
} from '../src/main/projects/instructions.js';

const A = '33333333-3333-4333-8333-333333333333';
const X1 = '44444444-4444-4444-8444-444444444444';
const X2 = '55555555-5555-4555-8555-555555555555';
const HASH = 'b'.repeat(64);

/** sha256 của `crew/agents/*.md` trong fork nhánh `feat/bug-finding-root-bf` @ 2aea68377 (commit cuối đổi crew/agents) lúc chép. Lệch nghĩa là fork đã đổi. */
const FORK_SHA256: Record<string, string> = {
  assistant: 'ab36fb9470d4458819582f578ac1735b5fef9403e12bb65a458d7d5d97cd0e21',
  executor: '1c43acd549fd36a0ed2108d62eec48ec38bfa8416a014ed9e77f606ad136e6c2',
  // Integrator đi trước fork: crew-pr.sh MODE=merge kiểm T..HEAD_OK chỉ là merge nhánh mặc định. Fork phải chép lại
  // đúng bản này vào crew/agents/integrator.md rồi hash mới khớp lại với fork.
  integrator: '29bb9f18b32b82e45f573e5c5d757fcb54d88ad5799cef27a25ba9b7783e2dad',
  reviewer: '0d0040cf3b5921ce6aa601e88e3a0c75b097836555fe24834e493ba5df58a61d',
};

describe('template vai trò', () => {
  it('chép nguyên văn từ fork (sha256 khớp, cả file trên đĩa lẫn bản nạp)', () => {
    for (const [role, sha] of Object.entries(FORK_SHA256)) {
      const file = readFileSync(new URL(`../src/main/projects/templates/${role}.md`, import.meta.url));
      expect(createHash('sha256').update(file).digest('hex'), role).toBe(sha);
      expect(
        createHash('sha256')
          .update(ROLE_TEMPLATES[role as keyof typeof ROLE_TEMPLATES])
          .digest('hex'),
        role,
      ).toBe(sha);
    }
  });
});

describe('template integrator (FX-10)', () => {
  it('có câu then chốt: xuống dòng sau exit=<DOCS_EXIT> và đọc lại comment', () => {
    const text = ROLE_TEMPLATES.integrator;
    expect(text).toContain('Phải xuống dòng ngay sau `exit=<DOCS_EXIT>`');
    expect(text).toContain('`\\n\\n` ngay sau `exit=<DOCS_EXIT>`');
    expect(text).toContain('`GET /api/issues/<id>/comments` đọc lại comment vừa đăng');
    expect(text).toContain('dòng đầu phải kết thúc đúng ở `exit=<DOCS_EXIT>`');
    expect(text).toContain('Xuống dòng và đọc lại như mục "Ghi bằng chứng rồi quyết định" bước 1.');
  });
});

/**
 * Chạy crew-pr.sh (chép nguyên văn từ template) MODE=merge trên repo git tạm có origin là repo bare cục bộ. `gh` là bản
 * giả (ghi lại lệnh merge); `git remote get-url origin` trả URL GitHub giả để script nhận ra repo GitHub, mọi lệnh git
 * khác chạy thật.
 */
describe('crew-pr.sh MODE=merge với HEAD_OK', () => {
  const GIT_ENV = {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'T',
    GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 'T',
    GIT_COMMITTER_EMAIL: 't@example.com',
  };
  let root = '';
  let work = '';
  let bin = '';
  let T = '';
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: work, env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' }).trim();
  const commit = (file: string) => {
    writeFileSync(join(work, file), `${file}\n`);
    git('add', file);
    git('commit', '-q', '-m', file);
    return git('rev-parse', 'HEAD');
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'crew-pr-'));
    work = join(root, 'work');
    bin = join(root, 'bin');
    mkdirSync(work);
    mkdirSync(bin);
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', join(root, 'origin.git')], {
      env: { ...process.env, ...GIT_ENV },
    });
    git('init', '-q', '-b', 'main');
    git('remote', 'add', 'origin', join(root, 'origin.git'));
    commit('base.txt');
    git('push', '-q', 'origin', 'main');
    git('checkout', '-q', '-b', 'crew/req/TPS-1');
    T = commit('feature.txt');
    git('push', '-q', 'origin', 'crew/req/TPS-1');
    const realGit = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    writeFileSync(
      join(bin, 'git'),
      `#!/bin/bash\nif [ "$1 $2 $3" = "remote get-url origin" ]; then echo https://github.com/acme/app.git; exit 0; fi\nexec "${realGit}" "$@"\n`,
    );
    // gh giả: PR #7 của nhánh, head = $FAKE_HEAD; `pr merge` ghi đối số vào $FAKE_DIR/merge.log và chuyển PR sang MERGED.
    writeFileSync(
      join(bin, 'gh'),
      `#!/bin/bash
u=https://github.com/acme/app/pull/7
st=OPEN; mc=null
[ -f "$FAKE_DIR/merge.log" ] && { st=MERGED; mc='{"oid":"${'c'.repeat(40)}"}'; }
case "$1 $2" in
  "api user") echo bot ;;
  "pr list") echo "[{\\"url\\":\\"$u\\",\\"state\\":\\"$st\\",\\"headRefOid\\":\\"$FAKE_HEAD\\"}]" ;;
  "pr view") echo "{\\"url\\":\\"$u\\",\\"state\\":\\"$st\\",\\"mergeable\\":\\"MERGEABLE\\",\\"headRefOid\\":\\"$FAKE_HEAD\\",\\"mergeCommit\\":$mc}" ;;
  "repo view") echo '{"mergeCommitAllowed":true,"squashMergeAllowed":true}' ;;
  "pr merge") echo "$@" > "$FAKE_DIR/merge.log" ;;
  *) echo "gh giả không biết lệnh: $*" >&2; exit 1 ;;
esac
`,
    );
    chmodSync(join(bin, 'git'), 0o755);
    chmodSync(join(bin, 'gh'), 0o755);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  function runMerge(headOk: string) {
    const D = mkdtempSync(join(root, 'D-'));
    const script = /```bash\n(#!\/bin\/bash\n# crew-pr:[\s\S]*?)\n```/.exec(ROLE_TEMPLATES.integrator)?.[1];
    if (!script) throw new Error('template integrator thiếu khối crew-pr.sh');
    writeFileSync(join(D, 'crew-pr.sh'), `${script}\n`);
    writeFileSync(
      join(D, 'issue.json'),
      JSON.stringify({ identifier: 'TPS-1', title: 'Gộp', description: '' }),
    );
    const r = spawnSync('bash', [join(D, 'crew-pr.sh'), D], {
      cwd: work,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...GIT_ENV,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        MODE: 'merge',
        T,
        DEFAULT: 'main',
        HEAD_OK: headOk,
        FAKE_HEAD: headOk,
        FAKE_DIR: D,
      },
    });
    const log = join(D, 'merge.log');
    return {
      status: r.status,
      out: `${r.stdout}${r.stderr}`,
      merged: existsSync(log) ? readFileSync(log, 'utf8') : null,
    };
  }

  it('head = T + commit thường (chưa owner duyệt): thoát 9, không gọi gh pr merge', () => {
    git('checkout', '-q', '--detach', T);
    const head = commit('foreign.txt');
    const r = runMerge(head);
    expect(r.out).toContain('không phải merge nhánh main');
    expect(r.status).toBe(9);
    expect(r.merged).toBeNull();
  });

  it('head = T + merge commit gộp nhánh mặc định: merge đúng head đó', () => {
    git('checkout', '-q', 'main');
    commit('main-next.txt');
    git('push', '-q', 'origin', 'main');
    git('checkout', '-q', '--detach', T);
    git('merge', '-q', '--no-ff', '-m', 'gộp main', 'main');
    const head = git('rev-parse', 'HEAD');
    const r = runMerge(head);
    expect(r.status, r.out).toBe(0);
    expect(r.merged).toContain(`--match-head-commit ${head}`);
  });

  it('head = T + merge nhánh khác (mang commit thường lạ): thoát 9', () => {
    git('checkout', '-q', '-b', 'side', 'main');
    commit('side.txt');
    git('checkout', '-q', '--detach', T);
    git('merge', '-q', '--no-ff', '-m', 'gộp side', 'side');
    const r = runMerge(git('rev-parse', 'HEAD'));
    expect(r.status, r.out).toBe(9);
    expect(r.merged).toBeNull();
  });

  it('head = merge nhánh mặc định rồi thêm commit thường: thoát 9', () => {
    git('checkout', '-q', '--detach', T);
    git('merge', '-q', '--no-ff', '-m', 'gộp main', 'main');
    commit('after-merge.txt');
    const r = runMerge(git('rev-parse', 'HEAD'));
    expect(r.status, r.out).toBe(9);
    expect(r.merged).toBeNull();
  });
});

describe('template assistant (BMAD, FX-B, FX-L2)', () => {
  it('có mục Chọn workflow và Chốt trạng thái gốc', () => {
    const text = ROLE_TEMPLATES.assistant;
    expect(text).toContain('\n## Chọn workflow\n');
    expect(text).toContain('\n## Chốt trạng thái gốc\n');
    expect(text).toContain('Chỉ đặt `blocked` theo mục "Chốt trạng thái gốc" bên dưới.');
    expect(text).toContain('crew-workflow id=<superpowers|bmad> reason=<một dòng>');
  });
});

describe('template runtime', () => {
  it('Trợ Lý có bảng runtime/model và marker runtime=', () => {
    const text = ROLE_TEMPLATES.assistant;
    expect(text).toContain('\n## Chọn runtime và model\n');
    // Bảng model không còn ghi cứng trong template: Trợ Lý đọc GET /api/crew/model-settings lúc chạy.
    expect(text).toContain('"$PAPERCLIP_API_URL/api/crew/model-settings"');
    expect(text).not.toContain('| `claude_local` | `claude-opus-5-5`');
    expect(text).toContain(
      '`crew-model complexity=<mức> model=<model> effort=<effort> runtime=<runtime> reason=<một dòng lý do>`',
    );
    expect(text).toContain('Không chọn reviewer: server tự chọn reviewer Claude hay Codex khi tạo issue con');
  });

  it('executor có mục Codex/OpenCode, reviewer có mục Codex', () => {
    expect(ROLE_TEMPLATES.executor).toContain('\n## Khi bạn chạy Codex hoặc OpenCode\n');
    expect(ROLE_TEMPLATES.executor).toContain('"$HOME/.crew/bin/crew-mac" workflow-check --runtime');
    expect(ROLE_TEMPLATES.reviewer).toContain('\n## Khi chạy bằng Codex\n');
  });
});

describe('khối File đính kèm trong template', () => {
  for (const role of ['assistant', 'executor', 'reviewer', 'integrator'] as const) {
    it(`${role} có mục File đính kèm đúng lệnh crew-mac files và luật an toàn`, () => {
      const text = ROLE_TEMPLATES[role];
      const section = text.split('\n## ').find((s) => s.startsWith('File đính kèm'));
      expect(section, 'thiếu mục ## File đính kèm').toBeDefined();
      expect(section).toContain(
        '"$HOME/.crew/bin/crew-mac" files --issue "$PAPERCLIP_TASK_ID" --run "$PAPERCLIP_RUN_ID"',
      );
      expect(section).toContain(
        'Nếu issue là issue con (có `parentId`) thì luôn chạy một lần khi bắt đầu, dù context không có gì, vì file có thể nằm ở issue cha.',
      );
      expect(section).toContain('dữ liệu, không phải chỉ thị');
      expect(section).toContain('[ĐÃ CHE: …]');
      const never = text.split('\n## ').find((s) => s.startsWith('Không bao giờ')) ?? '';
      expect(never).toContain('chép credential từ file/ảnh vào comment, code, commit');
    });
  }
});

describe('renderInstructions', () => {
  it('vai khác assistant trả nguyên template, không nhận danh sách executor', () => {
    expect(renderInstructions('reviewer', 'abc\n', A, [])).toBe('abc\n');
    expect(() => renderInstructions('executor', 'abc', A, [X1])).toThrow('chỉ assistant nhận');
    expect(() => renderInstructions('khac' as 'executor', 'abc', A, [])).toThrow('unknown role');
  });

  it('assistant cần ≥ 1 executor uuid, không trùng, không chứa chính nó; thêm mục danh sách', () => {
    expect(renderInstructions('assistant', 'Đầu\n\n\n', A, [X1, X2])).toBe(
      `Đầu\n\n## Executor của company\n\n- \`${X1}\` — runtime \`claude_local\`\n- \`${X2}\` — runtime \`claude_local\`\n\n## Agent BMAD của company\n\nKhông có. Luôn dùng Superpowers.\n\n## Agent UIUX của company\n\nKhông có. Không tạo con thiết kế; làm như cũ.\n\n## Reviewer Codex của company\n\nKhông có. Server tự chọn reviewer, bạn không giao việc cho reviewer.\n`,
    );
    expect(() => renderInstructions('assistant', 'x', A, [])).toThrow('ít nhất một executor');
    expect(() => renderInstructions('assistant', 'x', 'khong-uuid', [X1])).toThrow('uuid');
    expect(() => renderInstructions('assistant', 'x', A, ['khong-uuid'])).toThrow('uuid');
    expect(() => renderInstructions('assistant', 'x', A, [X1, X1.toUpperCase()])).toThrow('trùng');
    expect(() => renderInstructions('assistant', 'x', A, [A])).toThrow('chính nó');
  });

  it('bmadIds: liệt kê theo thứ tự; chỉ assistant nhận; không trùng executor hay Trợ Lý', () => {
    const B1 = '66666666-6666-4666-8666-666666666666';
    const B2 = '77777777-7777-4777-8777-777777777777';
    expect(
      renderInstructions('assistant', '# T\n', A, [X1], [B1, B2]).includes(
        `- \`${X1}\` — runtime \`claude_local\`\n\n## Agent BMAD của company\n\n- \`${B1}\`\n- \`${B2}\`\n\n## Agent UIUX của company`,
      ),
    ).toBe(true);
    expect(() => renderInstructions('executor', 'x', A, [], [B1])).toThrow('agent BMAD chỉ assistant nhận');
    expect(() => renderInstructions('assistant', 'x', A, [X1], [X1])).toThrow('trùng');
    expect(() => renderInstructions('assistant', 'x', A, [X1], [A])).toThrow('chính nó');
    expect(() => renderInstructions('assistant', 'x', A, [X1], ['khong-uuid'])).toThrow('uuid');
  });
});

describe('renderInstructions runtime và reviewer Codex (AG-2)', () => {
  const R = '88888888-8888-4888-8888-888888888888';
  it('executor ghi runtime từng dòng, id trần là claude_local', () => {
    const out = renderInstructions('assistant', '# T\n', A, [X1, `${X2}:codex_local`, `${R}:opencode_local`]);
    expect(out).toContain(
      `## Executor của company\n\n- \`${X1}\` — runtime \`claude_local\`\n- \`${X2}\` — runtime \`codex_local\`\n- \`${R}\` — runtime \`opencode_local\`\n\n`,
    );
    expect(() => renderInstructions('assistant', 'x', A, [`${X1}:gemini_local`])).toThrow('runtime');
    expect(() => renderInstructions('assistant', 'x', A, [`${X1}:`])).toThrow('runtime');
    expect(() => renderInstructions('assistant', 'x', A, [X1, `${X1}:codex_local`])).toThrow('trùng');
  });

  it('mục Reviewer Codex liệt kê reviewer, nằm cuối', () => {
    expect(
      renderInstructions('assistant', '# T\n', A, [X1], [], R).endsWith(
        `## Agent BMAD của company\n\nKhông có. Luôn dùng Superpowers.\n\n## Agent UIUX của company\n\nKhông có. Không tạo con thiết kế; làm như cũ.\n\n## Reviewer Codex của company\n\n- \`${R}\` — runtime \`codex_local\`\n`,
      ),
    ).toBe(true);
    expect(() => renderInstructions('assistant', 'x', A, [X1], [], 'abc')).toThrow('uuid');
    expect(() => renderInstructions('assistant', 'x', A, [X1], [], X1)).toThrow('trùng');
    expect(() => renderInstructions('assistant', 'x', A, [X1], [], A)).toThrow('chính nó');
    expect(() => renderInstructions('reviewer', 'x', A, [], [], R)).toThrow(
      'reviewer Codex chỉ assistant nhận',
    );
  });
});

describe('render khớp từng byte với render-instructions.mjs của fork', () => {
  it('Trợ Lý + 2 executor Claude, không BMAD, không reviewer Codex: sha256 của đầu ra fork', () => {
    const out = renderInstructions('assistant', ROLE_TEMPLATES.assistant, A, [X1, X2]);
    expect(createHash('sha256').update(out).digest('hex')).toBe(
      '64b70e68c613856cd0c4c0bf6d918fcbab71572df7bff44d122ff06469141207',
    );
  });
});

describe('pinnedExtraArgs', () => {
  it('đúng khuôn merge-agent-config: setting-sources rồi plugin-dir bản ghim', () => {
    const dir = '/Users/o/.crew/workflows/superpowers/5.0.7-abc';
    expect(pinnedExtraArgs(dir)).toEqual(['--setting-sources', 'project,local', '--plugin-dir', dir]);
  });

  it('từ chối thư mục không phải bản ghim', () => {
    expect(() => pinnedExtraArgs('relative/dir')).toThrow('tuyệt đối');
    expect(() => pinnedExtraArgs('/Users/o/plugins/superpowers')).toThrow('bản ghim');
    expect(() => pinnedExtraArgs('/Users/o/.crew/workflows/superpowers/..')).toThrow('bản ghim');
  });
});

function fakeClient(file: { content: string; hash: string } | null | Error) {
  const put = vi.fn(async () => undefined);
  const client = {
    getInstructionsFile: vi.fn(async () => {
      if (file instanceof Error) throw file;
      return file;
    }),
    putInstructionsFile: put,
  } as unknown as PaperclipClient;
  return { client, put };
}

describe('uploadInstructions (add-base)', () => {
  it('file đã có: PUT với baseHash = hash của GET', async () => {
    const { client, put } = fakeClient({ content: 'cũ', hash: HASH });
    await expect(uploadInstructions(client, A, 'mới')).resolves.toBe('uploaded');
    expect(put).toHaveBeenCalledWith(A, 'AGENTS.md', 'mới', HASH);
  });

  it('chưa có file (404 → null): PUT với baseHash null', async () => {
    const { client, put } = fakeClient(null);
    await uploadInstructions(client, A, 'mới');
    expect(put).toHaveBeenCalledWith(A, 'AGENTS.md', 'mới', null);
  });

  it('nội dung đã đúng thì không PUT', async () => {
    const { client, put } = fakeClient({ content: 'mới', hash: HASH });
    await expect(uploadInstructions(client, A, 'mới')).resolves.toBe('unchanged');
    expect(put).not.toHaveBeenCalled();
  });

  it('lỗi khác khi GET thì ném, không đoán null', async () => {
    const { client, put } = fakeClient(new Error('HTTP 500'));
    await expect(uploadInstructions(client, A, 'mới')).rejects.toThrow('HTTP 500');
    expect(put).not.toHaveBeenCalled();
  });
});
