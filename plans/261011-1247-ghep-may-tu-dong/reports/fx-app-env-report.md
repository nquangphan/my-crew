# fx-app-env report

Worktree `.worktrees/crew-pair` (r25-pair), one commit, not pushed.

Changes:
- `ensureMachineEnvironment`: finds same-name ssh env (active preferred). Active and matching host/port/knownHosts/path: reuse. Archived or stale: PATCH via new `client.updateEnvironment` (`status: active` + config, secret ref kept from the env itself, falling back to template). No DELETE, no suffix name. Create 409 maps to `ENV_NAME_TAKEN_MESSAGE`.
- `machine_revoked`: returns before any archive. Other failures archive only if `env.created`.
- Server PATCH (read only check): `updateEnvironmentSchema` strict, config shallow-merged with existing, needs instance-environment access (same as POST); name omitted.
- Tests: revoked then repair reusing archived env, stale PATCH, no PATCH when matching, no archive on revoked (new and reused env), create 409 message, client PATCH shape.
- Docs: `docs/flows/mac-app.md`, `docs/flows/mac-app-paperclip.md`.

Verified: vitest 611 pass, tsc clean, `node --test scripts/*.test.mjs` 24 pass, biome clean, `crew-docs check --staged` ok.

Note: reuse check does not compare `username` (spec list excluded it); a stale username on an otherwise matching active env is not patched.

Status: DONE
