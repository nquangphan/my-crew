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
  /** HMAC key for CSRF tokens. */
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
  /**
   * GitHub repository (`owner/name`) whose `runtime-v*` releases the server imports (hourly and on the owner's
   * request). Empty turns the import off; uploads from the web still work.
   */
  RUNTIME_RELEASES_REPO: z
    .string()
    .trim()
    .regex(/^$|^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'owner/name')
    .default('nquangphan/my-crew'),
  /**
   * Extra public keys (raw Ed25519, base64, comma-separated) whose runtime signatures this server accepts besides
   * the ones built in (@crew/shared RUNTIME_SIGNING_KEYS): a staging or test key.
   */
  RUNTIME_EXTRA_PUBLIC_KEYS: CsvList.default([]),
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
  /** `owner/name` of the GitHub repo runtime releases are imported from; null or absent: import off. */
  runtimeReleasesRepo?: string | null;
  /** Runtime signing keys accepted besides the built-in ones. */
  runtimeExtraKeys?: { id: string; publicKey: string }[];
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
    runtimeReleasesRepo: e.RUNTIME_RELEASES_REPO || null,
    runtimeExtraKeys: e.RUNTIME_EXTRA_PUBLIC_KEYS.map((publicKey, index) => ({
      id: `extra-${index + 1}`,
      publicKey,
    })),
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
