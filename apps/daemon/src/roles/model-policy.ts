import {
  type Complexity,
  DOCS_MODEL,
  type Effort,
  type ModelAlias,
  type RoleStage,
  type Ticket,
} from '@crew/shared';
import type { DaemonConfig } from '../config.js';

export interface ModelChoice {
  model: ModelAlias;
  effort: Effort;
  /** A Vietnamese comment for the ticket when the choice was clamped to the machine's allowlist. */
  notice: string | null;
}

/** Stage defaults when neither the ticket nor its complexity names a model. */
const STAGE_DEFAULTS: Record<RoleStage, { model: ModelAlias; effort: Effort }> = {
  assistant_triage: { model: 'haiku', effort: 'medium' },
  assistant_close: { model: 'haiku', effort: 'low' },
  pm_analyze: { model: 'sonnet', effort: 'high' },
  pm_monitor: { model: 'sonnet', effort: 'high' },
  pm_accept: { model: 'sonnet', effort: 'high' },
  dev: { model: 'sonnet', effort: 'high' },
  docs_update: { model: DOCS_MODEL, effort: 'high' },
  qc: { model: 'sonnet', effort: 'high' },
  docs_init: { model: DOCS_MODEL, effort: 'high' },
};

/** Strongest first: a model outside the allowlist falls back to the next allowed one below it. */
const STRENGTH: readonly ModelAlias[] = ['fable', 'opus', 'sonnet', 'haiku'];

type TicketModelFields = Pick<Ticket, 'model' | 'effort' | 'complexity'>;

/**
 * The model and effort of a run.
 *
 * - Docs work (docs-init, docs-update) is always `sonnet` / `high`, whatever the ticket, its complexity, the
 *   PM or the allowlist say (owner decision; the config refuses an allowlist without sonnet).
 * - The PM runs on sonnet, or opus when its task is rated `large` (cross-cutting work).
 * - Dev and QC take the subtask's model and effort, else the machine's complexity map, else the default.
 * - A model outside `models.allow` is clamped to the next allowed model below it and a notice is returned,
 *   which the daemon posts as a comment. Fable is therefore only used where the owner allowed it.
 */
export function resolveModel(input: {
  config: Pick<DaemonConfig, 'models'>;
  stage: RoleStage;
  ticket: TicketModelFields;
}): ModelChoice {
  const { config, stage, ticket } = input;
  const base = STAGE_DEFAULTS[stage];
  if (stage === 'docs_init' || stage === 'docs_update') {
    return { model: DOCS_MODEL, effort: 'high', notice: null };
  }
  let wanted: { model: ModelAlias; effort: Effort };
  if (stage === 'dev' || stage === 'qc') {
    const mapped = ticket.complexity ? config.models.complexityMap[ticket.complexity as Complexity] : null;
    wanted = {
      model: ticket.model ?? mapped?.model ?? base.model,
      effort: ticket.effort ?? mapped?.effort ?? base.effort,
    };
  } else if (stage.startsWith('pm_')) {
    wanted = {
      model: ticket.model ?? (ticket.complexity === 'large' ? 'opus' : base.model),
      effort: ticket.effort ?? base.effort,
    };
  } else {
    wanted = base;
  }
  const model = clampModel(wanted.model, config.models.allow);
  const notice =
    model === wanted.model
      ? null
      : `Model \`${wanted.model}\` không nằm trong danh sách được phép của máy này (${config.models.allow.join(', ')}), ` +
        `nên lượt chạy dùng \`${model}\` (effort \`${wanted.effort}\`).`;
  return { model, effort: wanted.effort, notice };
}

/** The allowed model at or below `wanted`; sonnet when nothing below is allowed (sonnet is always allowed). */
export function clampModel(wanted: ModelAlias, allow: readonly ModelAlias[]): ModelAlias {
  if (allow.includes(wanted)) return wanted;
  const below = STRENGTH.slice(STRENGTH.indexOf(wanted) + 1).find((model) => allow.includes(model));
  return below ?? 'sonnet';
}
