import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BMAD_MAX_STORIES, parseEpics } from '../src/bmad/epics.js';

const read = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', 'bmad', name), 'utf8');

const story = (n: number, m: number) =>
  `### Story ${n}.${m}: Việc ${n}.${m}\n\nAs a người dùng,\nI want việc ${n}.${m},\nSo that xong.\n\n` +
  '**Acceptance Criteria:**\n\n**Given** a\n**When** b\n**Then** c\n';

/** `stories` story chia đều cho các epic, mỗi epic tối đa 10 story. */
function make(stories: number): string {
  const parts: string[] = ['# x\n'];
  for (let n = 1, left = stories; left > 0; n++) {
    parts.push(`## Epic ${n}: Epic ${n}\n\nMục tiêu ${n}.\n`);
    const count = Math.min(10, left);
    for (let m = 1; m <= count; m++) parts.push(story(n, m));
    left -= count;
  }
  return parts.join('\n');
}

describe('parseEpics', () => {
  it('đọc đúng epic/story/tiêu chí của file chuẩn', () => {
    const r = parseEpics(read('epics-ok.md'));
    expect(r.problems).toEqual([]);
    expect(r.epics.map((e) => [e.n, e.title, e.storyKeys])).toEqual([
      [1, 'Trang giới thiệu', ['1.1', '1.2']],
      [2, 'Form liên hệ', ['2.1']],
    ]);
    expect(r.epics[0]?.goal).toBe('Người xem biết chủ trang là ai.');
    expect(r.stories.map((s) => s.key)).toEqual(['1.1', '1.2', '2.1']);
    expect(r.stories[0]).toMatchObject({ key: '1.1', epic: 1, seq: 1, title: 'Hiện thông tin' });
    expect(r.stories[0]?.acceptance).toEqual([
      'Given trang giới thiệu đã có dữ liệu; When người xem mở /gioi-thieu; Then trang hiện tên và mô tả ngắn',
      'Given chưa có dữ liệu; When người xem mở /gioi-thieu; Then trang hiện thông báo trống; And không lỗi 500',
    ]);
    expect(r.stories[0]?.body).toMatch(/^As a người xem,\nI want thấy tên và mô tả ngắn,/);
    expect(r.stories[0]?.body).toContain('**Acceptance Criteria:**');
    expect(r.stories[0]?.body).not.toContain('Story 1.2');
    expect(r.stories[2]?.acceptance).toHaveLength(2);
  });

  it.each([
    ['epics-gap.md', 'story 1.3: số thứ tự phải là 1.2'],
    ['epics-wrong-epic.md', 'story 2.1 nằm dưới Epic 1'],
    ['epics-no-ac.md', 'story 1.2: thiếu Acceptance Criteria'],
  ])('%s → %s', (file, problem) => {
    expect(parseEpics(read(file)).problems).toContain(problem);
  });

  it('story lạc epic không được tính hai lần', () => {
    const r = parseEpics(read('epics-wrong-epic.md'));
    expect(r.stories.map((s) => s.key)).toEqual(['1.1', '2.1']);
    expect(r.epics[0]?.storyKeys).toEqual(['1.1']);
  });

  it(`đúng ${BMAD_MAX_STORIES} story thì đạt, ${BMAD_MAX_STORIES + 1} story thì vượt trần`, () => {
    expect(BMAD_MAX_STORIES).toBe(30);
    expect(parseEpics(make(30)).problems).toEqual([]);
    expect(parseEpics(make(31)).problems).toContain('31 story, vượt trần 30');
  });

  it('không có epic nào', () => {
    expect(parseEpics('# x\n').problems).toContain('không có "## Epic N: <tên>" nào');
  });

  it('epic nhảy số, epic không story, story ngoài epic, tên rỗng hoặc quá dài', () => {
    const text = [
      '### Story 1.1: Lạc\n\n**Acceptance Criteria:**\n\n- a\n',
      '## Epic 1: Một\n\nMục tiêu.\n',
      '## Epic 3: Ba\n\nMục tiêu.\n',
      `### Story 3.1: ${'x'.repeat(201)}\n\n**Acceptance Criteria:**\n\n- a\n`,
      '### Story 3.2:\n\n**Acceptance Criteria:**\n\n- a\n',
    ].join('\n');
    const r = parseEpics(text);
    expect(r.problems).toEqual([
      'story 1.1 không nằm dưới epic nào',
      'epic 1: không có story nào',
      'epic 3: số thứ tự phải là 2',
      'story 3.1: tên rỗng hoặc dài hơn 200 ký tự',
      'story 3.2: tên rỗng hoặc dài hơn 200 ký tự',
    ]);
  });

  it('heading trong khối code bị bỏ qua', () => {
    const text = `${make(1)}\n\`\`\`md\n## Epic 9: giả\n### Story 9.1: giả\n\`\`\`\n`;
    const r = parseEpics(text);
    expect(r.problems).toEqual([]);
    expect(r.epics.map((e) => e.n)).toEqual([1]);
    expect(r.stories[0]?.body).toContain('## Epic 9: giả');
  });

  it('CRLF và khoảng trắng cuối dòng vẫn đọc đúng', () => {
    const text = read('epics-ok.md').replaceAll('\n', '  \r\n');
    const r = parseEpics(text);
    expect(r.problems).toEqual([]);
    expect(r.epics.map((e) => e.title)).toEqual(['Trang giới thiệu', 'Form liên hệ']);
    expect(r.stories[1]?.acceptance[1]).toBe(
      'Given không có ảnh; When người xem mở /gioi-thieu; Then hiện ảnh mặc định; And thẻ img có alt',
    );
    expect(r.stories[0]?.body).not.toContain('\r');
  });

  it('tiêu chí dạng danh sách và dòng nối tiếp', () => {
    const text =
      '## Epic 1: Một\n\nMục tiêu.\n\n### Story 1.1: A\n\nAs a x\n\n**Acceptance Criteria:**\n\n' +
      '- Trang trả 200\n- Có tiêu đề\n**Given** a\nvà a2\n**When** b\n**Then** c\n';
    expect(parseEpics(text).stories[0]?.acceptance).toEqual([
      'Trang trả 200',
      'Có tiêu đề',
      'Given a và a2; When b; Then c',
    ]);
  });

  it('khối Acceptance Criteria rỗng là thiếu tiêu chí', () => {
    const text = '## Epic 1: Một\n\nMục tiêu.\n\n### Story 1.1: A\n\nAs a x\n\n**Acceptance Criteria:**\n\n';
    expect(parseEpics(text).problems).toEqual(['story 1.1: thiếu Acceptance Criteria']);
  });
});
