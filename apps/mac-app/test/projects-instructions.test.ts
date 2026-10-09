import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
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

/** sha256 của `crew/agents/*.md` trong fork `crew/r2-5` @ eef987b01 lúc chép (gồm BMAD R2-3, FX-B, FX-L2 "Chốt trạng thái gốc", FX-10 của integrator, khối File đính kèm). Lệch nghĩa là fork đã đổi. */
const FORK_SHA256: Record<string, string> = {
  assistant: 'f67ea1df71920c9b4b03e59ed14d6e7d7df5906495a5dc8d9d22ab59e69fa321',
  executor: '2c4def90ac162a4863a64792d95a9f29ec5c1da4c3acd09c2ac8a6654d979c32',
  integrator: 'd0e0e82338738bb767b3a35e835f134d3fbd319137296ac2bd194b50a6233120',
  reviewer: 'aafad9e647b2cce3cf66d9c15672e42e2f9f9db6a418f88e7366e14ac1bd3d44',
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

describe('template assistant (BMAD, FX-B, FX-L2)', () => {
  it('có mục Chọn workflow và Chốt trạng thái gốc', () => {
    const text = ROLE_TEMPLATES.assistant;
    expect(text).toContain('\n## Chọn workflow\n');
    expect(text).toContain('\n## Chốt trạng thái gốc\n');
    expect(text).toContain('Chỉ đặt `blocked` theo mục "Chốt trạng thái gốc" bên dưới.');
    expect(text).toContain('crew-workflow id=<superpowers|bmad> reason=<một dòng>');
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
      `Đầu\n\n## Executor của company\n\n- \`${X1}\`\n- \`${X2}\`\n\n## Agent BMAD của company\n\nKhông có. Luôn dùng Superpowers.\n`,
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
      renderInstructions('assistant', '# T\n', A, [X1], [B1, B2]).endsWith(
        `- \`${X1}\`\n\n## Agent BMAD của company\n\n- \`${B1}\`\n- \`${B2}\`\n`,
      ),
    ).toBe(true);
    expect(() => renderInstructions('executor', 'x', A, [], [B1])).toThrow('agent BMAD chỉ assistant nhận');
    expect(() => renderInstructions('assistant', 'x', A, [X1], [X1])).toThrow('trùng');
    expect(() => renderInstructions('assistant', 'x', A, [X1], [A])).toThrow('chính nó');
    expect(() => renderInstructions('assistant', 'x', A, [X1], ['khong-uuid'])).toThrow('uuid');
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
