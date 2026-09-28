import { z } from 'zod';

const Bool = z.enum(['true', 'false']).transform((value) => value === 'true');
const CsvList = z.string().transform((value) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== ''),
);

const EnvSchema = z.object({
  DATABASE_URL: z.url(),
  /** HMAC key for login challenges and CSRF tokens. */
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  /** Public origin of the web app, e.g. https://crew.2p-solutions.com. Always in the Origin allow-list. */
  PUBLIC_ORIGIN: z.url(),
  /** Extra allowed origins (comma-separated), e.g. the Vite dev server. */
  ALLOWED_ORIGINS: CsvList.default([]),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  /**
   * Proxy addresses or CIDRs trusted for X-Forwarded-* (the Caddy network), comma-separated.
   * Empty means no proxy is trusted.
   */
  TRUST_PROXY: CsvList.default([]),
  COOKIE_SECURE: Bool.default(true),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(5),
  /** Budget days are calendar days in this zone. */
  BUDGET_TIMEZONE: z.string().default('Asia/Ho_Chi_Minh'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface AppConfig {
  databaseUrl: string;
  sessionSecret: string;
  allowedOrigins: string[];
  host: string;
  port: number;
  trustProxy: string[];
  cookieSecure: boolean;
  loginRateLimitPerMinute: number;
  budgetTimezone: string;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid API configuration: ${issues}`);
  }
  const e = parsed.data;
  assertTimezone(e.BUDGET_TIMEZONE);
  return {
    databaseUrl: e.DATABASE_URL,
    sessionSecret: e.SESSION_SECRET,
    allowedOrigins: [...new Set([new URL(e.PUBLIC_ORIGIN).origin, ...e.ALLOWED_ORIGINS.map(toOrigin)])],
    host: e.HOST,
    port: e.PORT,
    trustProxy: e.TRUST_PROXY,
    cookieSecure: e.COOKIE_SECURE,
    loginRateLimitPerMinute: e.LOGIN_RATE_LIMIT_PER_MINUTE,
    budgetTimezone: e.BUDGET_TIMEZONE,
    logLevel: e.LOG_LEVEL,
  };
}

function toOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`Invalid API configuration: ALLOWED_ORIGINS entry "${value}" is not a URL`);
  }
}

function assertTimezone(zone: string): void {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
  } catch {
    throw new Error(`Invalid API configuration: BUDGET_TIMEZONE "${zone}" is not a time zone`);
  }
}
