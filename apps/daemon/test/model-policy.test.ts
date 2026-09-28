import { Complexity, Effort, ModelAlias, RoleStage } from '@crew/shared';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { clampModel, resolveModel } from '../src/roles/model-policy.js';

const config = (allow?: ModelAlias[]) =>
  parseConfig({ apiUrl: 'http://127.0.0.1:1', machineName: 'm', ...(allow ? { models: { allow } } : {}) });

const ticket = (model: ModelAlias | null, effort: Effort | null, complexity: Complexity | null) => ({
  model,
  effort,
  complexity,
});

describe('model policy', () => {
  it('runs docs-init and docs-update on sonnet/high for every complexity, PM choice and allowlist', () => {
    const allowlists: ModelAlias[][] = [
      ['sonnet'],
      ['haiku', 'sonnet'],
      ['haiku', 'sonnet', 'opus', 'fable'],
    ];
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

  it('maps complexity for dev and QC, and the subtask model and effort win', () => {
    const c = config();
    const dev = (complexity: Complexity) =>
      resolveModel({ config: c, stage: 'dev', ticket: ticket(null, null, complexity) });
    expect(dev('trivial')).toMatchObject({ model: 'haiku', effort: 'low' });
    expect(dev('small')).toMatchObject({ model: 'sonnet', effort: 'medium' });
    expect(dev('medium')).toMatchObject({ model: 'sonnet', effort: 'high' });
    expect(dev('large')).toMatchObject({ model: 'opus', effort: 'high' });
    expect(resolveModel({ config: c, stage: 'qc', ticket: ticket('opus', 'xhigh', 'small') })).toMatchObject({
      model: 'opus',
      effort: 'xhigh',
    });
    expect(resolveModel({ config: c, stage: 'dev', ticket: ticket(null, null, null) })).toMatchObject({
      model: 'sonnet',
      effort: 'high',
    });
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
    const clamped = resolveModel({ config: c, stage: 'dev', ticket: ticket('fable', 'max', null) });
    expect(clamped).toMatchObject({ model: 'sonnet', effort: 'max' });
    expect(clamped.notice).toContain('fable');
    expect(clamped.notice).toContain('sonnet');
    // Fable is only used where the owner allowed it.
    expect(resolveModel({ config: config(), stage: 'dev', ticket: ticket('fable', null, null) }).model).toBe(
      'opus',
    );
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
});
