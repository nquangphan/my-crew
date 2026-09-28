import { createHmac, timingSafeEqual } from 'node:crypto';
import { CSRF_HEADER } from '@crew/shared';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../errors.js';

export const CSRF_COOKIE = 'crew_csrf';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const isMutating = (method: string) => MUTATING.has(method.toUpperCase());

/** Signed double-submit token: bound to the session, so a token planted from elsewhere never matches. */
export function csrfTokenFor(secret: string, sessionIdHash: string): string {
  return createHmac('sha256', secret).update(`csrf:${sessionIdHash}`).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Rejects a request whose Origin header is missing or not in the allow-list. */
export function assertAllowedOrigin(request: FastifyRequest, allowedOrigins: readonly string[]): void {
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.includes(origin)) {
    throw new ApiError('CSRF_FAILED', 'request origin is not allowed');
  }
}

/** The header must equal the cookie, and both must equal the token derived from the session. */
export function assertCsrfToken(request: FastifyRequest, expected: string): void {
  const header = request.headers[CSRF_HEADER];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  const fromCookie = request.cookies[CSRF_COOKIE];
  if (!fromHeader || !fromCookie || !safeEqual(fromHeader, fromCookie) || !safeEqual(fromHeader, expected)) {
    throw new ApiError('CSRF_FAILED', 'missing or invalid CSRF token');
  }
}
