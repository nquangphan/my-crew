import { z } from 'zod';

export const AgentRole = z.enum(['assistant', 'pm', 'dev', 'qc']);
export type AgentRole = z.infer<typeof AgentRole>;

export const Complexity = z.enum(['trivial', 'small', 'medium', 'large']);
export type Complexity = z.infer<typeof Complexity>;

export const ModelAlias = z.enum(['haiku', 'sonnet', 'opus', 'fable']);
export type ModelAlias = z.infer<typeof ModelAlias>;

export const Effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type Effort = z.infer<typeof Effort>;

/**
 * The step of a role's work one agent run performs. The daemon picks it from the ticket, its children and
 * the job kind; each stage has its own prompt, model default and legal status path.
 */
export const RoleStage = z.enum([
  'assistant_triage',
  'assistant_close',
  'pm_analyze',
  'pm_monitor',
  'pm_accept',
  'dev',
  'docs_update',
  'qc',
  'docs_init',
]);
export type RoleStage = z.infer<typeof RoleStage>;

/** All documentation work (the docs-init ticket and every docs-update job) runs on this model (owner decision). */
export const DOCS_MODEL: ModelAlias = 'sonnet';
