/**
 * Runtime decoders mirroring producer DTOs. Decoders reject missing fields, wrong primitives and unknown
 * keys; a key is tolerated only when listed as a reviewed additive field of that object.
 */

export class ContractError extends Error {
  readonly path: string;
  readonly expected: string;

  constructor(path: string, expected: string) {
    super(`RESPONSE_SHAPE_INVALID:${path}:${expected}`);
    this.name = 'ContractError';
    this.path = path;
    this.expected = expected;
  }
}

export type Decoder<T> = (value: unknown, path?: string) => T;
export type Infer<D> = D extends Decoder<infer T> ? T : never;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const decimalPattern = /^(0|[1-9][0-9]*)$/;
const maxCursor = 9223372036854775807n;

function fail(path: string, expected: string): never {
  throw new ContractError(path, expected);
}

export const str: Decoder<string> = (value, path = '$') =>
  typeof value === 'string' ? value : fail(path, 'string');

export const uuid: Decoder<string> = (value, path = '$') =>
  typeof value === 'string' && uuidPattern.test(value) ? value : fail(path, 'uuid');

export const int: Decoder<number> = (value, path = '$') =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : fail(path, 'integer');

export const num: Decoder<number> = (value, path = '$') =>
  typeof value === 'number' && Number.isFinite(value) ? value : fail(path, 'number');

export const nul: Decoder<null> = (value, path = '$') => (value === null ? null : fail(path, 'null'));

export const bool: Decoder<boolean> = (value, path = '$') =>
  typeof value === 'boolean' ? value : fail(path, 'boolean');

export function matching(pattern: RegExp, label: string): Decoder<string> {
  return (value, path = '$') =>
    typeof value === 'string' && pattern.test(value) ? value : fail(path, label);
}

/** Decimal event cursor kept as a string; never converted to Number. */
export const cursor: Decoder<string> = (value, path = '$') =>
  typeof value === 'string' && decimalPattern.test(value) && BigInt(value) <= maxCursor
    ? value
    : fail(path, 'decimal cursor');

export function isCursor(value: unknown): value is string {
  return typeof value === 'string' && decimalPattern.test(value) && BigInt(value) <= maxCursor;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

export function lit<const T extends readonly (string | number | boolean)[]>(
  ...values: T
): Decoder<T[number]> {
  return (value, path = '$') =>
    (values as readonly unknown[]).includes(value) ? (value as T[number]) : fail(path, values.join('|'));
}

export function nullable<T>(decoder: Decoder<T>): Decoder<T | null> {
  return (value, path = '$') => (value === null ? null : decoder(value, path));
}

export function arr<T>(decoder: Decoder<T>): Decoder<T[]> {
  return (value, path = '$') => {
    if (!Array.isArray(value)) fail(path, 'array');
    return value.map((item, index) => decoder(item, `${path}[${index}]`));
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Free-form JSON object owned by the producer (criteria, inputs, event data). */
export const jsonObject: Decoder<Record<string, unknown>> = (value, path = '$') =>
  isPlainObject(value) ? value : fail(path, 'object');

export function record<T>(decoder: Decoder<T>): Decoder<Record<string, T>> {
  return (value, path = '$') => {
    const source = jsonObject(value, path);
    return Object.fromEntries(
      Object.entries(source).map(([key, item]) => [key, decoder(item, `${path}.${key}`)]),
    );
  };
}

export function tuple4(decoder: Decoder<number>): Decoder<[number, number, number, number]> {
  return (value, path = '$') => {
    if (!Array.isArray(value) || value.length !== 4) fail(path, 'tuple4');
    return [
      decoder(value[0], `${path}[0]`),
      decoder(value[1], `${path}[1]`),
      decoder(value[2], `${path}[2]`),
      decoder(value[3], `${path}[3]`),
    ];
  };
}

type Shape = Record<string, Decoder<unknown>>;
type FromShape<S extends Shape> = { [K in keyof S]: Infer<S[K]> };
type ObjectOptions<O extends Shape> = { optional?: O; additive?: readonly string[] };

export function obj<S extends Shape, O extends Shape = Record<never, Decoder<unknown>>>(
  shape: S,
  options: ObjectOptions<O> = {},
): Decoder<FromShape<S> & Partial<FromShape<O>>> {
  const optional = (options.optional ?? {}) as O;
  const allowed = new Set([...Object.keys(shape), ...Object.keys(optional), ...(options.additive ?? [])]);
  return (value, path = '$') => {
    const source = jsonObject(value, path);
    for (const key of Object.keys(source)) if (!allowed.has(key)) fail(`${path}.${key}`, 'no unknown field');
    const output: Record<string, unknown> = {};
    for (const [key, decoder] of Object.entries(shape)) {
      if (!Object.hasOwn(source, key)) fail(`${path}.${key}`, 'present');
      output[key] = decoder(source[key], `${path}.${key}`);
    }
    for (const [key, decoder] of Object.entries(optional)) {
      if (Object.hasOwn(source, key)) output[key] = decoder(source[key], `${path}.${key}`);
    }
    return output as FromShape<S> & Partial<FromShape<O>>;
  };
}

export function oneOf<T>(...decoders: Decoder<T>[]): Decoder<T> {
  return (value, path = '$') => {
    for (const decoder of decoders) {
      try {
        return decoder(value, path);
      } catch (error) {
        if (!(error instanceof ContractError)) throw error;
      }
    }
    return fail(path, 'one of variants');
  };
}

export function page<T>(item: Decoder<T>, nextCursor: Decoder<string> = uuid) {
  return obj({ items: arr(item), nextCursor: nullable(nextCursor) });
}

export const decodeApiErrorBody = obj({
  error: obj({ code: str, message: str }, { optional: { details: (value: unknown) => value } }),
});
export type ApiErrorBody = Infer<typeof decodeApiErrorBody>;

export const decodeActor = oneOf<{ kind: 'owner'; id: 'owner' } | { kind: 'machine'; id: string }>(
  obj({ kind: lit('owner'), id: lit('owner') }),
  obj({ kind: lit('machine'), id: uuid }),
);
export type Actor = Infer<typeof decodeActor>;

const csrfToken: Decoder<string> = (value, path = '$') =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : fail(path, 'csrf token');

/** `v2/server/src/auth/routes.ts:141` — POST/GET `/v2/auth/session`. */
export const decodeSession = obj({ owner: obj({ id: lit('owner') }), csrfToken });
export type SessionDto = { owner: { id: 'owner' }; csrfToken: string };

/** Mirrors `Event`, `v2/server/src/platform/contracts.ts:13`. */
export const decodeJournalEvent = obj({
  cursor,
  type: str,
  projectId: nullable(uuid),
  ticketId: nullable(uuid),
  audienceMachineId: nullable(uuid),
  occurredAt: str,
  data: jsonObject,
});
export type JournalEvent = {
  cursor: string;
  type: string;
  projectId: string | null;
  ticketId: string | null;
  audienceMachineId: string | null;
  occurredAt: string;
  data: Record<string, unknown>;
};

/** GET `/v2/events` — `v2/server/src/journal/routes.ts:72`. */
export const decodeEventPage = obj({ items: arr(decodeJournalEvent), cursor });
export type EventPage = { items: JournalEvent[]; cursor: string };

/** GET `/v2/events/latest` (owner only) — `v2/server/src/journal/routes.ts:77`. */
export const decodeLatestCursor = obj({ cursor });
