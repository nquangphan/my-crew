/**
 * Đọc file epic/story do skill `bmad-create-epics-and-stories` ghi (khuôn `templates/epics-template.md` của BMAD):
 * `## Epic N: <tên>`, đoạn mục tiêu, `### Story N.M: <tên>`, khối "As a / I want / So that", rồi
 * `**Acceptance Criteria:**` với các dòng `**Given**`/`**When**`/`**Then**`/`**And**`. Heading và từ khóa giữ tiếng Anh
 * đúng như skill ghi, nội dung có thể tiếng Việt. Câu vấn đề cố định: Trợ Lý và reviewer đọc nguyên văn.
 */

/** Trần story mỗi file: vượt thì agent BMAD phải tách file hoặc hỏi owner. */
export const BMAD_MAX_STORIES = 30;
const MAX_TITLE = 200;

export interface BmadStory {
  key: string;
  epic: number;
  seq: number;
  title: string;
  /** Toàn bộ markdown của story (sau heading, tới heading cấp 1–3 kế tiếp), đã cắt khoảng trắng hai đầu. */
  body: string;
  /** Mỗi tiêu chí một dòng: `Given …; When …; Then …; And …` (bỏ `**`), hoặc một mục danh sách `- …`. */
  acceptance: string[];
}

export interface BmadEpic {
  n: number;
  title: string;
  goal: string;
  storyKeys: string[];
}

export interface EpicsParse {
  epics: BmadEpic[];
  stories: BmadStory[];
  problems: string[];
}

const EPIC_RE = /^## Epic (\d+):[ \t]*(.*?)[ \t]*$/;
const STORY_RE = /^### Story (\d+)\.(\d+):[ \t]*(.*?)[ \t]*$/;
const HEADING_RE = /^#{1,3} /;
const FENCE_RE = /^[ \t]{0,3}(```|~~~)/;
const AC_HEADING = '**Acceptance Criteria:**';
const AC_OPEN_RE = /^\*\*Given\*\*/;
const AC_JOIN_RE = /^\*\*(When|Then|And)\*\*/;
const LIST_RE = /^[-*+][ \t]+/;

const badTitle = (title: string) => title.length === 0 || title.length > MAX_TITLE;
const stripBold = (line: string) => line.replaceAll('**', '').replace(/\s+/g, ' ').trim();

/** Tiêu chí của một story; null khi không có dòng `**Acceptance Criteria:**`. */
function acceptanceOf(lines: readonly string[], fenced: readonly boolean[]): string[] | null {
  const start = lines.findIndex((line, i) => !fenced[i] && line.trim() === AC_HEADING);
  if (start < 0) return null;
  const criteria: string[] = [];
  let open = false;
  for (let i = start + 1; i < lines.length; i++) {
    if (fenced[i]) continue;
    const line = (lines[i] as string).trim();
    if (line === '' || line.startsWith('<!--')) continue;
    const item = line.replace(LIST_RE, '');
    if (AC_OPEN_RE.test(item)) {
      criteria.push(stripBold(item));
      open = true;
    } else if (AC_JOIN_RE.test(item) && open) {
      criteria[criteria.length - 1] += `; ${stripBold(item)}`;
    } else if (LIST_RE.test(line)) {
      criteria.push(stripBold(item));
      open = false;
    } else if (open) {
      criteria[criteria.length - 1] += ` ${stripBold(line)}`;
    }
  }
  return criteria.filter((c) => c.length > 0);
}

export function parseEpics(text: string): EpicsParse {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''));
  const fenced: boolean[] = [];
  let inFence = false;
  for (const line of lines) {
    const fence = FENCE_RE.test(line);
    fenced.push(inFence || fence);
    if (fence) inFence = !inFence;
  }
  const heading = (i: number) => !fenced[i] && HEADING_RE.test(lines[i] as string);
  /** Chỉ số dòng heading kế tiếp (cấp 1–3, ngoài khối code) sau `i`. */
  const nextHeading = (i: number) => {
    let j = i + 1;
    while (j < lines.length && !heading(j)) j++;
    return j;
  };

  const epics: BmadEpic[] = [];
  const stories: BmadStory[] = [];
  const problems: string[] = [];
  let epic: BmadEpic | null = null;
  let lastSeq = 0;
  const closeEpic = () => {
    if (epic && epic.storyKeys.length === 0) problems.push(`epic ${epic.n}: không có story nào`);
    epic = null;
  };

  for (let i = 0; i < lines.length; i++) {
    if (!heading(i)) continue;
    const line = lines[i] as string;
    const epicMatch = EPIC_RE.exec(line);
    const storyMatch = STORY_RE.exec(line);
    if (epicMatch) {
      closeEpic();
      const n = Number(epicMatch[1]);
      const title = epicMatch[2] as string;
      if (n !== epics.length + 1) problems.push(`epic ${n}: số thứ tự phải là ${epics.length + 1}`);
      if (badTitle(title)) problems.push(`epic ${n}: tên rỗng hoặc dài hơn ${MAX_TITLE} ký tự`);
      const end = nextHeading(i);
      const goal: string[] = [];
      for (let j = i + 1; j < end; j++) {
        const text = (lines[j] as string).trim();
        if (text === '' || text.startsWith('<!--') || fenced[j]) {
          if (goal.length > 0) break;
          continue;
        }
        goal.push(text);
      }
      const current: BmadEpic = { n, title, goal: goal.join(' '), storyKeys: [] };
      epics.push(current);
      epic = current;
      lastSeq = 0;
    } else if (storyMatch) {
      const n = Number(storyMatch[1]);
      const seq = Number(storyMatch[2]);
      const title = storyMatch[3] as string;
      const key = `${n}.${seq}`;
      const owner = epic as BmadEpic | null;
      if (!owner) {
        problems.push(`story ${key} không nằm dưới epic nào`);
        continue;
      }
      if (n !== owner.n) {
        problems.push(`story ${key} nằm dưới Epic ${owner.n}`);
        continue;
      }
      if (seq !== lastSeq + 1) problems.push(`story ${key}: số thứ tự phải là ${n}.${lastSeq + 1}`);
      lastSeq = seq;
      if (badTitle(title)) problems.push(`story ${key}: tên rỗng hoặc dài hơn ${MAX_TITLE} ký tự`);
      const end = nextHeading(i);
      const own = lines.slice(i + 1, end);
      const acceptance = acceptanceOf(own, fenced.slice(i + 1, end));
      if (!acceptance || acceptance.length === 0) problems.push(`story ${key}: thiếu Acceptance Criteria`);
      stories.push({ key, epic: n, seq, title, body: own.join('\n').trim(), acceptance: acceptance ?? [] });
      owner.storyKeys.push(key);
    } else if (/^## /.test(line)) {
      closeEpic();
    }
  }
  closeEpic();
  if (epics.length === 0) problems.push('không có "## Epic N: <tên>" nào');
  if (stories.length > BMAD_MAX_STORIES)
    problems.push(`${stories.length} story, vượt trần ${BMAD_MAX_STORIES}`);
  return { epics, stories, problems };
}
