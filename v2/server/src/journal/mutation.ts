import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import type { Db, Mutation, MutationContext, Mutator, ResponseCodec, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import { canonicalJson } from './canonical.ts';

const plainCodec: ResponseCodec = {
  encode: <T>(_context: MutationContext, result: Mutation<T>): unknown => result.body,
  decode: <T>(_context: MutationContext, status: number, response: unknown): Mutation<T> => ({
    status,
    body: response as T,
  }),
};

export function createMutator(db: Db, codec: ResponseCodec = plainCodec): Mutator {
  return async <T>(
    context: MutationContext,
    work: (tx: Tx) => Promise<Mutation<T>>,
  ): Promise<Mutation<T>> => {
    if (!/^[\x20-\x7e]{1,128}$/.test(context.key))
      throw new ApiError('IDEMPOTENCY_KEY_INVALID', 400, 'Khóa gửi lại không hợp lệ');
    let bodyJson: string;
    try {
      bodyJson = canonicalJson(context.body);
    } catch {
      throw new ApiError('BODY_INVALID', 400, 'Nội dung yêu cầu không hợp lệ');
    }
    const hash = createHash('sha256').update(bodyJson).digest('hex');
    const scope = canonicalJson([context.actor.kind, context.actor.id, context.route, context.key]);
    return db.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${scope}, 0))`;
      const [existing] =
        await tx`select body_hash, status, response from idempotency where actor_kind = ${context.actor.kind} and actor_id = ${context.actor.id} and route = ${context.route} and key = ${context.key}`;
      if (existing) {
        if (existing.body_hash !== hash)
          throw new ApiError('IDEMPOTENCY_CONFLICT', 409, 'Khóa gửi lại có nội dung khác');
        return codec.decode<T>(context, Number(existing.status), existing.response);
      }
      await tx`select value from event_cursor where singleton = true for update`;
      const result = await work(tx);
      const response = codec.encode(context, result);
      let safeResponse: postgres.JSONValue;
      try {
        safeResponse = JSON.parse(canonicalJson(response));
      } catch {
        throw new ApiError('RESPONSE_INVALID', 500, 'Phản hồi không hợp lệ');
      }
      await tx`insert into idempotency (actor_kind, actor_id, route, key, body_hash, status, response, created_at) values (${context.actor.kind}, ${context.actor.id}, ${context.route}, ${context.key}, ${hash}, ${result.status}, ${tx.json(safeResponse)}, now())`;
      return result;
    });
  };
}

export function mutate<T>(
  db: Db,
  context: MutationContext,
  work: (tx: Tx) => Promise<Mutation<T>>,
): Promise<Mutation<T>> {
  return createMutator(db)(context, work);
}
