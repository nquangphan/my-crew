/** Postgres SQLSTATE of the error, or of the error's cause (drizzle wraps driver errors). */
function sqlState(error: unknown): string | undefined {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    if (typeof current !== 'object') return undefined;
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export const isUniqueViolation = (error: unknown) => sqlState(error) === '23505';
