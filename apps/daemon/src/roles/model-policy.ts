import {
  type Complexity,
  DOCS_MODEL,
  type Effort,
  type ModelAlias,
  type RoleStage,
  type SelectableModel,
  type Ticket,
} from '@crew/shared';
import type { DaemonConfig } from '../config.js';

export interface ModelChoice {
  model: SelectableModel;
  effort: Effort;
  /**
   * A Vietnamese comment for the ticket when the choice changed: a legacy `fable` ticket runs on opus, or the
   * model was clamped to the machine's allowlist.
   */
  notice: string | null;
}

/** Stages whose model the PM chooses by rating the subtask's complexity: they have no default. */
type RatedStage = 'dev' | 'qc';
type DefaultedStage = Exclude<RoleStage, RatedStage | 'docs_init' | 'docs_update'>;

/** Models of the assistant and PM stages (docs stages are fixed on DOCS_MODEL). */
const STAGE_DEFAULTS: Record<DefaultedStage, { model: SelectableModel; effort: Effort }> = {
  assistant_triage: { model: 'haiku', effort: 'medium' },
  assistant_close: { model: 'haiku', effort: 'low' },
  pm_analyze: { model: 'sonnet', effort: 'high' },
  pm_monitor: { model: 'sonnet', effort: 'high' },
  pm_accept: { model: 'sonnet', effort: 'high' },
};

/**
 * A dev, bug or QC ticket without the PM's complexity rating (a ticket created before the rating was
 * required). The run fails through the crash path, which comments this message and blocks the ticket.
 */
export class MissingComplexityError extends Error {
  constructor(stage: RatedStage) {
    super(
      `Ticket này chưa được PM đánh giá độ phức tạp (complexity) nên không chọn được model cho lượt ${stage === 'qc' ? 'QC' : 'dev'}: ` +
        'không có model mặc định cho dev và QC. PM cần đánh giá ngay trên ticket này bằng công cụ rate_subtask ' +
        '(complexity trivial | small | medium | large và complexityReason một dòng lý do), không tạo subtask thay ' +
        'thế: ticket sẽ tự chạy lại trên model theo mức đánh giá.',
    );
    this.name = 'MissingComplexity';
  }
}

/** Strongest first: a model outside the allowlist falls back to the next allowed one below it. */
const STRENGTH: readonly SelectableModel[] = ['opus', 'sonnet', 'haiku'];

/** Fable is not used at all (owner decision): a legacy ticket that still names it runs on opus. */
const LEGACY_FABLE_NOTICE =
  'Ticket này còn đặt model `fable` từ trước, nhưng Fable không còn được dùng, nên lượt chạy dùng `opus`.';

type TicketModelFields = Pick<Ticket, 'model' | 'effort' | 'complexity'>;

/**
 * The model and effort of a run.
 *
 * - Docs work (docs-init, docs-update) is always `sonnet` / `high`, whatever the ticket, its complexity, the
 *   PM or the allowlist say (owner decision; the config refuses an allowlist without sonnet).
 * - The PM runs on sonnet, or opus when its task is rated `large` (cross-cutting work).
 * - Dev (and bug) and QC runs take the machine's complexity map entry for the PM's rating; a model or effort
 *   the PM set on the subtask overrides it (the rating and its reason are still required). A ticket
 *   without a rating throws MissingComplexityError: there is no default model for dev or QC.
 * - Fable is never used: a legacy ticket model `fable` becomes `opus`, with a notice.
 * - A model outside `models.allow` is clamped to the next allowed model below it and a notice is returned,
 *   which the daemon posts as a comment.
 */
export function resolveModel(input: {
  config: Pick<DaemonConfig, 'models'>;
  stage: RoleStage;
  ticket: TicketModelFields;
}): ModelChoice {
  const { config, stage, ticket } = input;
  if (stage === 'docs_init' || stage === 'docs_update') {
    return { model: DOCS_MODEL, effort: 'high', notice: null };
  }
  let wanted: { model: ModelAlias; effort: Effort };
  if (stage === 'dev' || stage === 'qc') {
    if (!ticket.complexity) throw new MissingComplexityError(stage);
    const mapped = config.models.complexityMap[ticket.complexity as Complexity];
    wanted = { model: ticket.model ?? mapped.model, effort: ticket.effort ?? mapped.effort };
  } else if (stage.startsWith('pm_')) {
    const base = STAGE_DEFAULTS[stage];
    wanted = {
      model: ticket.model ?? (ticket.complexity === 'large' ? 'opus' : base.model),
      effort: ticket.effort ?? base.effort,
    };
  } else {
    wanted = STAGE_DEFAULTS[stage];
  }
  const legacyFable = wanted.model === 'fable';
  const selectable: SelectableModel = wanted.model === 'fable' ? 'opus' : wanted.model;
  const model = clampModel(selectable, config.models.allow);
  const notices = [
    ...(legacyFable ? [LEGACY_FABLE_NOTICE] : []),
    ...(model === selectable
      ? []
      : [
          `Model \`${selectable}\` không nằm trong danh sách được phép của máy này (${config.models.allow.join(', ')}), ` +
            `nên lượt chạy dùng \`${model}\` (effort \`${wanted.effort}\`).`,
        ]),
  ];
  return { model, effort: wanted.effort, notice: notices.length > 0 ? notices.join(' ') : null };
}

/** The allowed model at or below `wanted`; sonnet when nothing below is allowed (sonnet is always allowed). */
export function clampModel(wanted: SelectableModel, allow: readonly SelectableModel[]): SelectableModel {
  if (allow.includes(wanted)) return wanted;
  const below = STRENGTH.slice(STRENGTH.indexOf(wanted) + 1).find((model) => allow.includes(model));
  return below ?? 'sonnet';
}
