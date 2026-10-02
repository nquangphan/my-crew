import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Sql, TransactionSql } from 'postgres';
import type { Signal, Status } from '../../../src/ticket-policy.ts';
import type { Pin } from '../../../src/workflow-policy.ts';

export type Id = string;
export type Revision = number;
export type Actor = { kind: 'owner'; id: 'owner' } | { kind: 'machine'; id: Id };
export type Db = Sql;
export type Tx = TransactionSql;
export type Mutation<T> = { status: number; body: T };
export type ApiErrorBody = { error: { code: string; message: string; details?: unknown } };
export type Event = {
  cursor: string;
  type: string;
  projectId: Id | null;
  ticketId: Id | null;
  audienceMachineId: Id | null;
  occurredAt: string;
  data: Record<string, unknown>;
};
export type EventInput = Omit<Event, 'cursor' | 'occurredAt'>;
export type MutationContext = {
  actor: Actor;
  route: string;
  key: string;
  body: unknown;
  readonly authorize?: (tx: Tx) => Promise<void>;
};
export type DispatchPermit = {
  commandId: Id;
  ticketId: Id;
  machineId: Id;
  bindingRevision: number;
  ticketRevision: number;
  workflow: Pin;
  checkedAt: string;
  expiresAt: string;
  telemetryId: Id;
  decisionId: Id;
};
export type AuthorizeDispatch = (tx: Tx, actor: Actor, permit: DispatchPermit) => Promise<void>;
export type ServerOptions = {
  db: Db;
  publicOrigin: string;
  secureCookies: boolean;
  sessionEncryptionKey: Buffer;
  now: () => Date;
  authorizeDispatch: AuthorizeDispatch;
  verifyFinalResult: (
    tx: Tx,
    input: {
      attemptId: Id;
      ticketId: Id;
      kind: 'code' | 'research' | 'docs' | 'deploy';
      outcome: 'passed' | 'retry' | 'needs_input';
      evidenceIds: Id[];
    },
  ) => Promise<void>;
};
export type Mutator = <T>(c: MutationContext, work: (tx: Tx) => Promise<Mutation<T>>) => Promise<Mutation<T>>;
export type ResponseCodec = {
  encode<T>(c: MutationContext, result: Mutation<T>): unknown;
  decode<T>(c: MutationContext, status: number, response: unknown): Mutation<T>;
};
export type TicketSignal = Signal;
export type TicketStatus = Status;
export type Authenticator = {
  authenticate: (request: FastifyRequest) => Promise<Actor>;
  requireOwner: (request: FastifyRequest, input: { csrf: boolean }) => Promise<Actor>;
};
export type RouteDependencies = { mutator: Mutator; auth: Authenticator };
export type RegisterRoutes = (app: FastifyInstance, options: ServerOptions, deps: RouteDependencies) => void;
