import { createHash } from 'node:crypto';
import type { ProjectionPin, Runtime, SourcePin, Workflow } from '../gateway/contracts.ts';
import { runtimes } from '../gateway/contracts.ts';
import { canonicalJson } from '../journal/canonical.ts';
import type { Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type { SkillStep, WorkflowRun } from './contracts.ts';

export type WorkflowPath = WorkflowRun['path'];
export type DefinitionSkill = { path: string; sha256: string };
/** Definition the gateway of machine B reported for one installed projection slot (S3b). */
export type WorkflowDefinitionRecord = {
  source: SourcePin;
  projection: ProjectionPin;
  definition: {
    sha256: string;
    skills: DefinitionSkill[];
    customizationSha256: string;
    render: Record<string, unknown> | null;
  };
};
/**
 * Trusted definition lookup. The caller's hash is only a key: a record exists only
 * when the machine's stored install report proves it for a current slot.
 */
export type DefinitionLookup = (
  tx: Tx,
  machineId: Id,
  definitionSha256: string,
) => Promise<WorkflowDefinitionRecord | null>;

const digest = /^[0-9a-f]{64}$/;
const sha256 = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const plainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const same = (left: unknown, right: unknown) => {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
};

function skillsOf(value: unknown): DefinitionSkill[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 512) return null;
  const skills: DefinitionSkill[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (
      !plainObject(item) ||
      Object.keys(item).length !== 2 ||
      typeof item.path !== 'string' ||
      !item.path ||
      item.path.length > 512 ||
      typeof item.sha256 !== 'string' ||
      !digest.test(item.sha256) ||
      seen.has(item.path)
    )
      return null;
    seen.add(item.path);
    skills.push({ path: item.path, sha256: item.sha256 });
  }
  return skills;
}

/**
 * Reads only `gateway_applied.workflow_status` of the given machine. A definition
 * counts only on a `current` projection slot whose source slot is also `current`,
 * and only when the gateway's canonical digest over the slot pins, skills,
 * customization and render recomputes to the requested hash. The applied revision
 * is never used to infer a definition.
 */
export function createDefinitionLookup(): DefinitionLookup {
  return async (tx, machineId, definitionSha256) => {
    if (!digest.test(definitionSha256)) return null;
    const [row] =
      await tx`select workflow_status from gateway_applied where machine_id=${machineId} for share`;
    const status: unknown = row?.workflow_status;
    if (!plainObject(status)) return null;
    const found: WorkflowDefinitionRecord[] = [];
    for (const workflow of ['superpowers', 'bmad'] as Workflow[]) {
      const entry = status[workflow];
      if (!plainObject(entry) || !plainObject(entry.source) || !plainObject(entry.projections)) continue;
      const sourceSlot = entry.source;
      if (sourceSlot.state !== 'current' || !plainObject(sourceSlot.installed)) continue;
      const source = sourceSlot.installed as SourcePin;
      if (source.name !== workflow) continue;
      for (const runtime of runtimes as Runtime[]) {
        const slot = entry.projections[runtime];
        if (!plainObject(slot) || slot.state !== 'current' || !plainObject(slot.installed)) continue;
        const definition = slot.definition;
        if (!plainObject(definition) || definition.sha256 !== definitionSha256) continue;
        const projection = slot.installed as ProjectionPin;
        const skills = skillsOf(definition.skills);
        const customizationSha256 = definition.customizationSha256;
        const render = definition.render === undefined ? null : definition.render;
        if (
          projection.runtime !== runtime ||
          projection.sourceTreeSha256 !== source.sourceTreeSha256 ||
          !skills ||
          typeof customizationSha256 !== 'string' ||
          !digest.test(customizationSha256) ||
          (render !== null && !plainObject(render))
        )
          continue;
        // BMAD has a definition only for the Claude projection and always carries its render
        // expectation; Superpowers never renders.
        if (workflow === 'bmad' ? runtime !== 'claude' || render === null : render !== null) continue;
        if (render && (!same(render.source, source) || !same(render.projection, projection))) continue;
        if (sha256({ source, projection, skills, customizationSha256, render }) !== definitionSha256)
          continue;
        found.push({
          source,
          projection,
          definition: { sha256: definitionSha256, skills, customizationSha256, render },
        });
      }
    }
    return found.length === 1 ? (found[0] ?? null) : null;
  };
}

export type GateSpec = {
  kind: string;
  requiredActor: 'owner' | 'delegated';
  /** Exact lines of the pinned source that define the gate. */
  citation: string;
};
export type StepSpec = {
  key: string;
  skill: string;
  sourcePath: string;
  citation: string;
  role: SkillStep['role'];
  kind: 'code' | 'research';
  title: string;
  acceptance: string[];
  outputKinds: string[];
  gates: GateSpec[];
};

const sp = (skill: string) => `skills/${skill}/SKILL.md`;
const bmad = (file: string) => `.claude/skills/bmad-build/${file}`;

// Superpowers 6.4.2 (source revision 8ca22dba…, payload 29714b2c…). Citations are
// lines of the pinned archive files; the graph is ordered and sequential by default.
const implement: StepSpec = {
  key: 'implement',
  skill: 'test-driven-development',
  sourcePath: sp('test-driven-development'),
  citation:
    'skills/test-driven-development/SKILL.md:31-34; skills/brainstorming/SKILL.md:127; skills/writing-plans/SKILL.md:200-204',
  role: 'implement',
  kind: 'code',
  title: 'Triển khai theo TDD',
  acceptance: [
    'Mỗi thay đổi mã sản phẩm có test đỏ trước, rồi xanh',
    'Phương pháp thực thi theo lựa chọn đã duyệt ở cổng kế hoạch (nếu có)',
  ],
  outputKinds: ['code', 'test'],
  gates: [],
};
const review: StepSpec = {
  key: 'review',
  skill: 'requesting-code-review',
  sourcePath: sp('requesting-code-review'),
  citation: 'skills/requesting-code-review/SKILL.md:12-18',
  role: 'review',
  kind: 'code',
  title: 'Yêu cầu review mã',
  acceptance: ['Review độc lập trên toàn bộ thay đổi trước khi gộp'],
  outputKinds: ['review'],
  gates: [],
};
const verify: StepSpec = {
  key: 'verify',
  skill: 'verification-before-completion',
  sourcePath: sp('verification-before-completion'),
  citation: 'skills/verification-before-completion/SKILL.md:14-36',
  role: 'review',
  kind: 'code',
  title: 'Xác minh trước khi hoàn tất',
  acceptance: ['Bằng chứng kiểm tra mới chạy, không tuyên bố hoàn tất khi thiếu bằng chứng'],
  outputKinds: ['verification'],
  gates: [],
};
const debugPhase = (
  key: string,
  title: string,
  lines: string,
  acceptance: string,
  outputKind: string,
): StepSpec => ({
  key,
  skill: 'systematic-debugging',
  sourcePath: sp('systematic-debugging'),
  citation: `skills/systematic-debugging/SKILL.md:${lines}`,
  role: 'research',
  kind: 'research',
  title,
  acceptance: [acceptance],
  outputKinds: [outputKind],
  gates: [],
});

const superpowersPaths: Record<'architectural' | 'bounded' | 'bug' | 'spike', StepSpec[]> = {
  architectural: [
    {
      key: 'design',
      skill: 'brainstorming',
      sourcePath: sp('brainstorming'),
      citation: 'skills/brainstorming/SKILL.md:81-84,129-134,171-176',
      role: 'research',
      kind: 'research',
      title: 'Brainstorming: thiết kế theo từng phần',
      acceptance: ['Chủ dự án duyệt từng phần thiết kế đã trình bày'],
      outputKinds: ['design'],
      gates: [
        {
          kind: 'design_approval',
          requiredActor: 'owner',
          citation: 'skills/brainstorming/SKILL.md:45-49,134,174-176',
        },
      ],
    },
    {
      key: 'spec',
      skill: 'brainstorming',
      sourcePath: sp('brainstorming'),
      citation: 'skills/brainstorming/SKILL.md:135-138,237-261',
      role: 'research',
      kind: 'research',
      title: 'Brainstorming: spec viết và tự review',
      acceptance: ['Spec đã ghi, tự review, chủ dự án duyệt bản viết'],
      outputKinds: ['spec'],
      gates: [
        {
          kind: 'spec_approval',
          requiredActor: 'owner',
          citation: 'skills/brainstorming/SKILL.md:46-49,256-261',
        },
      ],
    },
    {
      key: 'plan',
      skill: 'writing-plans',
      sourcePath: sp('writing-plans'),
      citation: 'skills/writing-plans/SKILL.md:179-204',
      role: 'research',
      kind: 'research',
      title: 'Viết kế hoạch triển khai',
      acceptance: ['Chủ dự án review kế hoạch và chọn phương pháp thực thi'],
      outputKinds: ['plan'],
      gates: [
        {
          kind: 'plan_approval_execution_method',
          requiredActor: 'owner',
          citation: 'skills/brainstorming/SKILL.md:46-48; skills/writing-plans/SKILL.md:181-198',
        },
      ],
    },
    implement,
    review,
    verify,
  ],
  bounded: [
    {
      key: 'design',
      skill: 'brainstorming',
      sourcePath: sp('brainstorming'),
      citation: 'skills/brainstorming/SKILL.md:71-80,122-127',
      role: 'research',
      kind: 'research',
      title: 'Brainstorming: thiết kế ngắn trong hội thoại',
      acceptance: ['Chủ dự án nói đồng ý với thiết kế ngắn; không spec, không plan'],
      outputKinds: ['design'],
      gates: [
        {
          kind: 'design_approval',
          requiredActor: 'owner',
          citation: 'skills/brainstorming/SKILL.md:45,76-80,126',
        },
      ],
    },
    implement,
    review,
    verify,
  ],
  bug: [
    debugPhase(
      'root_cause',
      'Debug pha 1: điều tra nguyên nhân gốc',
      '14-20,48-119',
      'Có bằng chứng nguyên nhân gốc trước mọi đề xuất sửa',
      'evidence',
    ),
    debugPhase(
      'pattern',
      'Debug pha 2: phân tích mẫu',
      '120-142',
      'Đối chiếu mẫu chạy đúng và khác biệt',
      'pattern',
    ),
    debugPhase(
      'hypothesis',
      'Debug pha 3: giả thuyết và kiểm chứng',
      '143-167',
      'Một giả thuyết được kiểm chứng tối thiểu',
      'hypothesis',
    ),
    {
      key: 'fix',
      skill: 'systematic-debugging',
      sourcePath: sp('systematic-debugging'),
      citation: 'skills/systematic-debugging/SKILL.md:168-196',
      role: 'fix',
      kind: 'code',
      title: 'Debug pha 4: test đỏ rồi một bản sửa',
      acceptance: [
        'Test tái hiện đỏ trước khi sửa',
        'Sau ba lần sửa thất bại phải thảo luận kiến trúc trước lần thứ tư',
      ],
      outputKinds: ['code', 'test'],
      gates: [
        {
          kind: 'architecture_discussion',
          requiredActor: 'owner',
          citation: 'skills/systematic-debugging/SKILL.md:190-212',
        },
      ],
    },
    review,
    verify,
  ],
  spike: [
    {
      key: 'probe',
      skill: 'brainstorming',
      sourcePath: sp('brainstorming'),
      citation: 'skills/brainstorming/SKILL.md:65-70,115-118',
      role: 'research',
      kind: 'research',
      title: 'Spike: câu hỏi và cách thử',
      acceptance: ['Chủ dự án duyệt câu hỏi và cách thử; không spec, không design doc'],
      outputKinds: ['probe'],
      gates: [
        {
          kind: 'probe_approval',
          requiredActor: 'owner',
          citation: 'skills/brainstorming/SKILL.md:44,118',
        },
      ],
    },
    {
      key: 'investigate',
      skill: 'brainstorming',
      sourcePath: sp('brainstorming'),
      citation: 'skills/brainstorming/SKILL.md:65-70,119-120,188-189',
      role: 'research',
      kind: 'research',
      title: 'Spike: điều tra và báo cáo khuyến nghị',
      acceptance: [
        'Kết quả là khuyến nghị nghiên cứu; mọi thứ dựng ra là throwaway, không hoàn tất mã sản phẩm',
      ],
      outputKinds: ['research'],
      gates: [],
    },
  ],
};

// BMAD 6.12.0 bmad-build (source revision 05bfbd46…). Source paths are the audited
// Claude projection files; runtime follows the rendered snapshot just in time.
const bmadClarify: StepSpec = {
  key: 'step-01',
  skill: 'bmad-build',
  sourcePath: bmad('step-01-clarify-and-route.md'),
  citation: 'src/bmm-skills/ship/bmad-build/workflow.md:82-84; step-01-clarify-and-route.md:15-100',
  role: 'research',
  kind: 'research',
  title: 'BMAD bước 1: làm rõ và định tuyến',
  acceptance: ['Giữ nguyên ý định, cây sạch hoặc chủ dự án quyết định, chọn spec_file'],
  outputKinds: ['intent'],
  gates: [],
};
const bmadPlan = (gates: GateSpec[], citation: string): StepSpec => ({
  key: 'step-02',
  skill: 'bmad-build',
  sourcePath: bmad('step-02-plan.md'),
  citation,
  role: 'research',
  kind: 'research',
  title: 'BMAD bước 2: lập kế hoạch và spec',
  acceptance: ['Điều tra trước khi chọn dispatch hay oneshot; không ghi khoảng trống ý định thành giả định'],
  outputKinds: ['spec'],
  gates,
});
const bmadPaths: Record<'bmad-dispatch' | 'bmad-oneshot', StepSpec[]> = {
  'bmad-dispatch': [
    bmadClarify,
    bmadPlan(
      [
        {
          kind: 'spec_approval',
          requiredActor: 'owner',
          citation: 'src/bmm-skills/ship/bmad-build/step-02-plan.md:36-58',
        },
      ],
      'src/bmm-skills/ship/bmad-build/step-02-plan.md:9-62',
    ),
    {
      key: 'step-03',
      skill: 'bmad-build',
      sourcePath: bmad('step-03-implement.md'),
      citation: 'src/bmm-skills/ship/bmad-build/step-03-implement.md:13-51',
      role: 'implement',
      kind: 'code',
      title: 'BMAD bước 3: triển khai theo spec đã duyệt',
      acceptance: ['Triển khai đúng spec ready-for-dev, kiểm acceptance và matrix test'],
      outputKinds: ['code', 'test'],
      gates: [],
    },
    {
      key: 'step-04',
      skill: 'bmad-build',
      sourcePath: bmad('step-04-review.md'),
      citation: 'src/bmm-skills/ship/bmad-build/step-04-review.md:21-85',
      role: 'review',
      kind: 'code',
      title: 'BMAD bước 4: review nhiều lớp rồi phân loại',
      acceptance: ['Khởi chạy mọi lớp review đã cấu hình trước khi đọc kết quả, rồi phân loại'],
      outputKinds: ['review'],
      gates: [],
    },
    {
      key: 'step-05',
      skill: 'bmad-build',
      sourcePath: bmad('step-05-present.md'),
      citation: 'src/bmm-skills/ship/bmad-build/step-05-present.md:11-39',
      role: 'implement',
      kind: 'code',
      title: 'BMAD bước 5: đánh dấu xong, commit và trình bày',
      acceptance: ['Spec done, commit và tóm tắt cho chủ dự án'],
      outputKinds: ['summary'],
      gates: [],
    },
  ],
  'bmad-oneshot': [
    bmadClarify,
    bmadPlan([], 'src/bmm-skills/ship/bmad-build/step-02-plan.md:9-22'),
    {
      key: 'step-oneshot',
      skill: 'bmad-build',
      sourcePath: bmad('step-oneshot.md'),
      citation: 'src/bmm-skills/ship/bmad-build/step-oneshot.md:1-103',
      role: 'implement',
      kind: 'code',
      title: 'BMAD oneshot: triển khai, review và trình bày',
      acceptance: [
        'Giữ lớp review chính thức của oneshot',
        'Khi phát sinh khoảng trống ý định hoặc việc không thể hoàn tác thì quay lại lập kế hoạch dispatch',
      ],
      outputKinds: ['code', 'test', 'review', 'summary'],
      gates: [],
    },
  ],
};

export const workflowPaths: readonly WorkflowPath[] = Object.freeze([
  'architectural',
  'bounded',
  'bug',
  'spike',
  'bmad-dispatch',
  'bmad-oneshot',
]);

export function workflowOfPath(path: WorkflowPath): Workflow {
  return path === 'bmad-dispatch' || path === 'bmad-oneshot' ? 'bmad' : 'superpowers';
}

/** Ordered official stages of a path. Unknown paths have no graph. */
export function workflowSteps(path: WorkflowPath): readonly StepSpec[] {
  if (path === 'bmad-dispatch' || path === 'bmad-oneshot') return bmadPaths[path];
  if (path === 'architectural' || path === 'bounded' || path === 'bug' || path === 'spike')
    return superpowersPaths[path];
  throw new ApiError('VALIDATION', 400, 'Đường workflow không hợp lệ');
}

/** Source bytes hash of every stage, from the definition. A missing stage source waits (422). */
export function stepSources(path: WorkflowPath, skills: readonly DefinitionSkill[]): Map<string, string> {
  const byPath = new Map(skills.map((skill) => [skill.path, skill.sha256]));
  const result = new Map<string, string>();
  for (const step of workflowSteps(path)) {
    const sha = byPath.get(step.sourcePath);
    if (!sha)
      throw new ApiError(
        'WORKFLOW_SKILL_MISSING',
        422,
        'Definition thiếu nguồn chính thức của bước workflow',
      );
    result.set(step.sourcePath, sha);
  }
  return result;
}
