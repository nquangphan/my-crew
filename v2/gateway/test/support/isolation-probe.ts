const args = process.argv.slice(2).filter((arg) => arg !== '--');
if (
  args.length !== 3 ||
  args[0] !== '--runtime' ||
  !['claude', 'codex'].includes(args[1]) ||
  args[2] !== '--no-model'
) {
  throw new Error('Usage: isolation:probe -- --runtime claude|codex --no-model');
}
process.env.CREW_ISOLATION_PROBE_RUNTIME = args[1];
await import('../isolation-workspace.test.ts');

export {};
