import { z } from 'zod';

export const AgentRole = z.enum(['assistant', 'pm', 'dev', 'qc']);
export type AgentRole = z.infer<typeof AgentRole>;

export const Complexity = z.enum(['trivial', 'small', 'medium', 'large']);
export type Complexity = z.infer<typeof Complexity>;

export const ModelAlias = z.enum(['haiku', 'sonnet', 'opus', 'fable']);
export type ModelAlias = z.infer<typeof ModelAlias>;

export const Effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type Effort = z.infer<typeof Effort>;
