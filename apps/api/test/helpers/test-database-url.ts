/** Tests use a dedicated database on the crew dev Postgres (docker-compose.dev.yml, host port 55432). */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://crew:crew@127.0.0.1:55432/crew_test';

/** The test setup wipes the database, so refuse anything that is not clearly a test database. */
export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run tests against "${name}": the database name must end with _test`);
  }
}
