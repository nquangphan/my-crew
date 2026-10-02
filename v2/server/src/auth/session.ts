import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { canonicalJson } from '../journal/canonical.ts';
import type { Db, Mutation, MutationContext, ResponseCodec } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';

const cookieName = 'crew_v2_session';
const sessionAge = 12 * 60 * 60 * 1000;

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomSecret(): string {
  return randomBytes(32).toString('hex');
}

function encrypt(key: Buffer, plaintext: string, aad: string): string {
  if (key.length !== 32) throw new Error('SESSION_ENCRYPTION_KEY_INVALID');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

function decrypt(key: Buffer, ciphertext: string, aad: string): string {
  if (key.length !== 32) throw new Error('SESSION_ENCRYPTION_KEY_INVALID');
  const source = Buffer.from(ciphertext, 'base64');
  if (source.length < 28) throw new Error('CIPHERTEXT_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', key, source.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(source.subarray(12, 28));
  return Buffer.concat([decipher.update(source.subarray(28)), decipher.final()]).toString('utf8');
}

export function credentialResponseCodec(key: Buffer): ResponseCodec {
  return {
    encode<T>(context: MutationContext, result: Mutation<T>): unknown {
      if (context.route !== 'POST:/v2/machines') return result.body;
      const aad = canonicalJson([context.actor.kind, context.actor.id, context.route, context.key]);
      return { ciphertext: encrypt(key, JSON.stringify(result.body), aad) };
    },
    decode<T>(context: MutationContext, status: number, response: unknown): Mutation<T> {
      if (context.route !== 'POST:/v2/machines') return { status, body: response as T };
      if (
        !response ||
        typeof response !== 'object' ||
        !('ciphertext' in response) ||
        typeof response.ciphertext !== 'string'
      ) {
        throw new ApiError('REPLAY_INVALID', 503, 'Không đọc được kết quả yêu cầu');
      }
      const aad = canonicalJson([context.actor.kind, context.actor.id, context.route, context.key]);
      try {
        return { status, body: JSON.parse(decrypt(key, response.ciphertext, aad)) as T };
      } catch {
        throw new ApiError('REPLAY_INVALID', 503, 'Không đọc được kết quả yêu cầu');
      }
    },
  };
}

export function readSessionCookie(request: FastifyRequest): string | null {
  const cookie = request.headers.cookie;
  if (!cookie) return null;
  const candidate = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  const value = candidate?.slice(cookieName.length + 1);
  return value && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

export function makeSessionCookie(secret: string, secure: boolean): string {
  return `${cookieName}=${secret}; Path=/v2; HttpOnly; SameSite=Strict; Max-Age=43200${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${cookieName}=; Path=/v2; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

export async function createSession(
  db: Db,
  key: Buffer,
  now: Date,
): Promise<{ secret: string; csrfToken: string }> {
  const secret = randomSecret();
  const csrfToken = randomSecret();
  await db`insert into sessions (id_hash, owner_id, csrf_hash, csrf_ciphertext, expires_at)
    values (${sha256(secret)}, 'owner', ${sha256(csrfToken)}, ${encrypt(key, csrfToken, sha256(secret))}, ${new Date(now.getTime() + sessionAge)})`;
  return { secret, csrfToken };
}

export async function getSession(
  db: Db,
  request: FastifyRequest,
  now: Date,
): Promise<{ idHash: string; csrfHash: string; csrfCiphertext: string }> {
  const secret = readSessionCookie(request);
  if (!secret) throw new ApiError('UNAUTHENTICATED', 401, 'Cần đăng nhập');
  const [row] = await db`select id_hash, csrf_hash, csrf_ciphertext from sessions
    where id_hash=${sha256(secret)} and owner_id='owner' and revoked_at is null and expires_at>${now}`;
  if (!row) throw new ApiError('UNAUTHENTICATED', 401, 'Cần đăng nhập');
  return {
    idHash: row.id_hash as string,
    csrfHash: row.csrf_hash as string,
    csrfCiphertext: row.csrf_ciphertext as string,
  };
}

export function revealCsrf(key: Buffer, session: { idHash: string; csrfCiphertext: string }): string {
  try {
    return decrypt(key, session.csrfCiphertext, session.idHash);
  } catch {
    throw new ApiError('SESSION_INVALID', 401, 'Phiên đăng nhập không hợp lệ');
  }
}

export async function revokeSession(db: Db, request: FastifyRequest, now: Date): Promise<void> {
  const secret = readSessionCookie(request);
  if (secret)
    await db`update sessions set revoked_at=${now} where id_hash=${sha256(secret)} and revoked_at is null`;
}
