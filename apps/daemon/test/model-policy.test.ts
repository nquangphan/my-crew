import { Complexity, Effort, ModelAlias, RoleStage, SelectableModel } from '@crew/shared';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { clampModel, MissingComplexityError, resolveModel } from '../src/roles/model-policy.js';

const config = (allow?: SelectableModel[]) =>
  parseConfig({ apiUrl: 'http://127.0.0.1:1', machineName: 'm', ...(allow ? { models: { allow } } : {}) });

const ticket = (model: ModelAlias | null, effort: Effort | null, complexity: Complexity | null) => ({
  model,
  effort,
  complexity,
});

describe('model policy', () => {
  it('runs docs-init and docs-update on sonnet/high for every complexity, PM choice and allowlist', () => {
    const allowlists: SelectableModel[][] = [['sonnet'], ['haiku', 'sonnet'], ['haiku', 'sonnet', 'opus']];
    for (const stage of ['docs_init', 'docs_update'] as const) {
      for (const allow of allowlists) {
        for (const complexity of [null, ...Complexity.options]) {
          for (const model of [null, ...ModelAlias.options]) {
            for (const effort of [null, ...Effort.options]) {
              expect(
                resolveModel({ config: config(allow), stage, ticket: ticket(model, effort, complexity) }),
              ).toEqual({ model: 'sonnet', effort: 'high', notice: null });
            }
          }
        }
      }
    }
  });

  it('maps the PM rating for dev and QC through the machine complexity map', () => {
    const c = config();
    for (const stage of ['dev', 'qc'] as const) {
      const run = (complexity: Complexity) =>
        resolveModel({ config: c, stage, ticket: ticket(null, null, complexity) });
      expect(run('trivial')).toEqual({ model: 'haiku', effort: 'low', notice: null });
      expect(run('small')).toEqual({ model: 'sonnet', effort: 'medium', notice: null });
      expect(run('medium')).toEqual({ model: 'sonnet', effort: 'high', notice: null });
      expect(run('large')).toEqual({ model: 'opus', effort: 'high', notice: null });
    }
    // The machine's own map is used, not a built-in table.
    const custom = parseConfig({
      apiUrl: 'http://127.0.0.1:1',
      machineName: 'm',
      models: { complexityMap: { small: { model: 'opus', effort: 'xhigh' } } },
    });
    expect(resolveModel({ config: custom, stage: 'qc', ticket: ticket(null, null, 'small') })).toMatchObject({
      model: 'opus',
      effort: 'xhigh',
    });
  });

  it('lets a model or effort the PM set on the subtask override the map', () => {
    const c = config();
    expect(resolveModel({ config: c, stage: 'qc', ticket: ticket('opus', 'xhigh', 'small') })).toMatchObject({
      model: 'opus',
      effort: 'xhigh',
    });
    expect(resolveModel({ config: c, stage: 'dev', ticket: ticket('haiku', null, 'large') })).toMatchObject({
      model: 'haiku',
      effort: 'high',
    });
    expect(resolveModel({ config: c, stage: 'dev', ticket: ticket(null, 'max', 'trivial') })).toMatchObject({
      model: 'haiku',
      effort: 'max',
    });
  });

  it('has no default model for dev or QC: a ticket without a rating fails, even with a model set', () => {
    const c = config();
    for (const stage of ['dev', 'qc'] as const) {
      for (const model of [null, ...ModelAlias.options]) {
        expect(() => resolveModel({ config: c, stage, ticket: ticket(model, 'high', null) })).toThrow(
          MissingComplexityError,
        );
      }
    }
    expect(() => resolveModel({ config: c, stage: 'qc', ticket: ticket(null, null, null) })).toThrow(
      /chưa được PM đánh giá độ phức tạp.*lượt QC/,
    );
  });

  it('uses the stage defaults: haiku for the assistant, sonnet for the PM, opus for large PM work', () => {
    const c = config();
    const empty = ticket(null, null, null);
    expect(resolveModel({ config: c, stage: 'assistant_triage', ticket: empty })).toMatchObject({
      model: 'haiku',
      effort: 'medium',
    });
    expect(resolveModel({ config: c, stage: 'assistant_close', ticket: empty })).toMatchObject({
      model: 'haiku',
      effort: 'low',
    });
    for (const stage of ['pm_analyze', 'pm_monitor', 'pm_accept'] as const) {
      expect(resolveModel({ config: c, stage, ticket: empty })).toMatchObject({
        model: 'sonnet',
        effort: 'high',
      });
      expect(resolveModel({ config: c, stage, ticket: ticket(null, null, 'large') })).toMatchObject({
        model: 'opus',
      });
    }
  });

  it('clamps a model outside the allowlist to the next allowed one below and says so', () => {
    const c = config(['haiku', 'sonnet']);
    const clamped = resolveModel({ config: c, stage: 'dev', ticket: ticket('opus', 'max', 'large') });
    expect(clamped).toMatchObject({ model: 'sonnet', effort: 'max' });
    expect(clamped.notice).toContain('opus');
    expect(clamped.notice).toContain('sonnet');
    expect(clampModel('haiku', ['sonnet', 'opus'])).toBe('sonnet');
    expect(clampModel('opus', ['haiku', 'sonnet'])).toBe('sonnet');
    for (const stage of RoleStage.options) {
      const choice = resolveModel({
        config: config(['sonnet']),
        stage,
        ticket: ticket('opus', null, 'large'),
      });
      expect(choice.model).toBe('sonnet');
    }
  });

  it('never resolves to fable: a legacy ticket model fable runs on opus with a notice', () => {
    const c = config();
    for (const stage of ['dev', 'qc', 'pm_analyze', 'pm_monitor', 'pm_accept'] as const) {
      const choice = resolveModel({ config: c, stage, ticket: ticket('fable', 'max', 'large') });
      expect(choice).toMatchObject({ model: 'opus', effort: 'max' });
      expect(choice.notice).toContain('Fable không còn được dùng');
    }
    // Opus not allowed on this machine: both notices, and the next allowed model below.
    const clamped = resolveModel({
      config: config(['haiku', 'sonnet']),
      stage: 'dev',
      ticket: ticket('fable', null, 'large'),
    });
    expect(clamped.model).toBe('sonnet');
    expect(clamped.notice).toContain('Fable không còn được dùng');
    expect(clamped.notice).toContain('`opus` không nằm trong danh sách được phép');
    // Whatever the ticket, the rating and the allowlist say, the run model is a selectable one.
    for (const stage of RoleStage.options) {
      for (const model of [null, ...ModelAlias.options]) {
        for (const complexity of Complexity.options) {
          const choice = resolveModel({ config: c, stage, ticket: ticket(model, null, complexity) });
          expect(SelectableModel.options).toContain(choice.model);
        }
      }
    }
  });
});
