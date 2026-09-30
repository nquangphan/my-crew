# Phase 2 implementation report: signed hot updates, stable signing identity, Full Disk Access once

Date: 2026-09-30. Branch: `main` (uncommitted working tree, nothing staged). Status: done, with one owner step left
(the local keychain prompt, below).

## What was built

### Shell / runtime split (apps/desktop)

- **Shell** (changes only with a dmg): Electron, the main process (`out/main`), the preload, and the app's
  `node_modules` (better-sqlite3, Agent SDK, MCP SDK, electron-updater). The main process stays in the shell on
  purpose: it is the code that verifies bundles, so it must not be replaceable by a bundle.
- **Runtime bundle** (hot-updatable): the daemon host with the bundled daemon library and role prompts
  (`out/runtime/host`, built on its own by `electron.vite.host.config.ts` so it shares no chunk with the main
  process; it carries a `package.json` `{"type":"module"}`) and the renderer (`out/runtime/renderer`).
- `apps/desktop/package.json`: version **0.3.0** and `crewRuntime: { version: "0.3.0", shell: ">=0.3.0 <0.4.0" }`.
  `pnpm build:app` builds both configs and writes the builtin manifest (`scripts/runtime-bundle.mjs builtin`).

### Bundle format and signing

- `crew-runtime-<v>.tar.gz` (strict ustar, regular files only), `crew-runtime-<v>.manifest.json` (format 1,
  version, commit, createdAt, `shellRange {app, electron-major}`, tarball SHA-256/size, every file's SHA-256/size),
  `crew-runtime-<v>.manifest.sig` (Ed25519 over the manifest's exact bytes).
- Trusted public keys: `RUNTIME_SIGNING_KEYS` in `packages/shared/src/runtime-schemas.ts` (a list, for rotation).
  The build refuses a signing key whose public half is not in that list; without a key it emits an unsigned
  bundle with a loud warning, which the server and every app refuse (no silent unsigned path).
- `scripts/runtime-bundle.mjs builtin | release | verify`.

### Server (apps/api)

- Migration `0009_runtime_releases.sql` (additive): `runtime_releases`, `runtime_bundles` (bytea; bundles are
  ~1 MB and live in Postgres, so backups include them; no deploy change needed), `machines.runtime_state`,
  `machines.runtime_pinned_version`.
- Routes: owner `GET /v1/runtime/releases`, `GET /v1/runtime/latest`, `POST /v1/runtime/releases` (upload),
  `POST /v1/runtime/releases/import` (GitHub), `PUT /v1/machines/:id/runtime` (pin / rollback / unpin); daemon
  `GET /v1/daemon/runtime` (pinned release, else newest whose shell range admits the machine's app version, plus
  `latest`), `GET /v1/daemon/runtime/:version/bundle`.
- The server re-verifies signature, manifest and tarball hash before storing; versions are immutable (409).
- Hourly import of signed `runtime-v*` GitHub Releases (`RUNTIME_RELEASES_REPO`, default `nquangphan/my-crew`,
  empty disables; `RUNTIME_EXTRA_PUBLIC_KEYS` for a staging/test key), so CI needs no server credential.
- Events `runtime.published` (owner + every machine), `runtime.pinned`, `machine.runtime_changed`; the heartbeat
  stores the machine's runtime state; `Machine.runtime` in the owner DTO.

### Machine flow (apps/desktop main + host, apps/daemon)

- `RuntimeManager` (shell): at launch picks the active installed runtime only after full verification
  (signature, shell range, ownership, every file hash, no extra files), else an earlier one, else the builtin.
  Checks at first host ready, on `runtime.published`/`runtime.pinned` (daemon → host event `runtime.changed`),
  hourly, and on the "Kiểm tra runtime" button. The host only downloads (into `~/.crew/runtime/.incoming`);
  the main process verifies tarball hash, signature, shell range and every tar entry, unpacks to a staging dir
  and renames to `~/.crew/runtime/<version>/` (0700 dirs, 0600 files), links `node_modules` to the app's.
- Switch: waits up to 30 min for running jobs, then `supervisor.relaunch()` (graceful stop, jobs requeued and
  resumed) and reloads the window on the new renderer. No app restart, no reinstall.
- Probation (5 min): 2 ready timeouts or 3 host crashes → automatic rollback to the previous runtime, the
  version is marked failed and never retried, state `rolled_back` is reported. Checks during probation run when
  it ends. Keeps the active runtime plus two previous ones.
- A runtime whose shell range needs a newer app sets `shell_update_required` (ask for a dmg).
- Daemon library: `VpsClient.runtime()` / `runtimeBundle()`, dispatcher effect `runtime_changed`, options
  `runtime` (heartbeat field) and `onRuntimeChanged`.

### Web

Machines page: "Bản runtime" section (newest releases, "Nhập bản mới từ GitHub"), per machine the app version,
runtime version and source, update state, and a pin select ("Theo bản mới nhất" / a version) — pinning an older
release is the rollback.

### Stable code-signing identity

- Self-signed "2P Crew Code Signing" certificate (RSA 3072, code-signing EKU, 10 years). Public part committed as
  `apps/desktop/signing/codesign-cert.crt` (`*.pem` is gitignored).
- electron-builder cannot use an untrusted identity, so it signs ad hoc and `package-mac.mjs` (`afterSign`)
  re-signs each app with the identity (`scripts/codesign.mjs`) and verifies it, before the dmg/zip are made.
  Without the identity: ad hoc with a warning (locally) or a failure (`CREW_CODESIGN_REQUIRED=1` in CI).
- CI release job imports the p12 into a temporary keychain and runs `codesign.mjs verify` on both apps: signature
  valid (`--deep --strict`) and the designated requirement names `com.2p-solutions.crew` and the committed
  certificate's SHA-1 (verified empirically: the default requirement is `certificate root = H"<sha1>"`, root =
  leaf for a self-signed certificate).
- CI `runtime-release` job on `runtime-v*` tags: build, sign, `verify`, `gh release create --latest=false` (so the
  app updater keeps reading the app release).

### Full Disk Access once

Main process probes `~/Library/Safari` and the user TCC database (never prompts): granted / denied / unknown.
Wizard step "Quyền ổ đĩa" (skippable) and a status-view section explain it in Vietnamese, one button opens
`x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles`, and it re-checks on focus. The
folder-access waiting logic stays as the fallback.

## Keys and secrets (names and locations only)

| Item | Where |
|---|---|
| Ed25519 runtime signing key (private, PEM) | GitHub secret `CREW_RUNTIME_SIGNING_KEY`; copy `runtime-signing-key.pem` in the scratchpad keys folder |
| Its public key | `packages/shared/src/runtime-schemas.ts` (`crew-runtime-2026-09`); copy `runtime-signing-key.pub.pem` |
| Code-signing p12 (base64) | GitHub secret `CREW_CODESIGN_P12_BASE64`; copies `codesign.p12`, `codesign.p12.base64` |
| p12 password | GitHub secret `CREW_CODESIGN_P12_PASSWORD`; copy `codesign-p12-password.txt` |
| Certificate private key / cert | `codesign-key.pem`, `codesign-cert.pem` (public part also in the repo as `signing/codesign-cert.crt`) |
| Login keychain | certificate and private key imported (codesign in the ACL) |

Scratchpad keys folder (0700, files 0600):
`/private/tmp/claude-501/-Users-phannhatquang-Documents-projects-crew/2a7c667a-cb0d-453f-92de-961ca559b0ea/scratchpad/keys/`.
No secret value was printed or written into the repo; secrets were set with `gh secret set NAME < file`.

## Owner's remaining manual steps

1. Move the private material from the scratchpad keys folder into a password manager, then delete the folder
   (it is a temporary directory).
2. Local signing: the identity is in the login keychain, but the first `codesign` use waits for the macOS prompt
   "codesign wants to sign using key … in your keychain" (my non-interactive attempt timed out, so I stopped
   there as instructed). On the first `pnpm --filter @crew/desktop package:mac`, enter the login password and
   click **Always Allow**. Alternative in a Terminal (asks for the password):
   `security set-key-partition-list -S apple-tool:,apple:,codesign: -s ~/Library/Keychains/login.keychain-db`.
   Check with `security find-identity -p codesigning | grep "2P Crew"`.
3. Release 0.3.0 (commit, tag `v0.3.0`): CI signs it with the certificate. Install the dmg once ("Open Anyway"
   once: not notarized), then grant Full Disk Access once from the new wizard step or status view. Later runtime
   fixes: bump `crewRuntime.version`, tag `runtime-v<version>`; the server imports it within the hour (or click
   "Nhập bản mới từ GitHub").
4. Optionally set `RUNTIME_RELEASES_REPO` on the VPS only if it differs from the default.

## Tests

- New: `packages/shared/src/runtime-schemas.test.ts` (versions, ranges, manifest paths, heartbeat tolerance),
  `apps/api/test/runtime.test.ts` (upload, bad/foreign signature, tampered bundle/manifest, traversal in manifest,
  desired/pinned/latest, bundle download auth, heartbeat state + events, GitHub import incl. unsigned/foreign
  skipped), `apps/desktop/test/runtime-update.test.ts` (install and 0700/0600 perms; unsigned, foreign-signed,
  edited manifest; tampered tarball and tampered entry; wrong shell range and Electron major; path traversal,
  absolute path, symlink, hardlink, extra entry; on-disk tampering; test keys only in test mode; decision rules;
  state machine: download → verify → wait for jobs → switch, refused download, rollback after 2 ready timeouts,
  rollback after 3 crashes in 5 min, rollback when the switch fails, check after probation, pruning, pin to
  older and to builtin, launch fallback when the active bundle no longer verifies, disabled in dev),
  `apps/desktop/test/full-disk-access.test.ts` (mocked probes), `apps/desktop/test/codesign.test.ts`
  (requirement check; an ad-hoc binary fails the CI check), supervisor `relaunch()`/`host-crash`, host-service
  runtime check/download/heartbeat against the real API, daemon dispatcher, web `machines.test.tsx` (versions,
  state, pin/unpin, import).
- E2E: `apps/desktop/test/e2e/runtime-update.spec.ts` — a signed test bundle uploaded to the test server reaches
  the running staged app, which switches host and renderer to `~/.crew/runtime/0.3.50` in the same process
  (verified by host and renderer markers, same app pid, daemon running again, web shows the new runtime); then a
  bundle whose host exits at once is rolled back automatically and the web shows `rolled_back`. Onboarding E2E
  covers the Full Disk Access step.
- Results: `pnpm -r typecheck` ok; `pnpm lint` ok; `pnpm -r --workspace-concurrency=1 test` ok (shared 68, API 249,
  web 115, docs-kit 41, daemon 227 + 4 skipped, desktop 72 + 1 skipped); `pnpm -r build` ok; web E2E 24/24;
  desktop Electron E2E 4/4 (after `pnpm --filter @crew/desktop stage`). The web production build still
  type-checks only `src` (no new imports outside it; shared stays browser-safe).

## Deviations

- The Electron main process is not part of the runtime bundle (it verifies bundles); fixes there need a dmg.
- Renderer↔host IPC stays validated against the shell's schemas; a runtime needing a new IPC method needs a shell
  update. (Forwarding unknown methods was tried and reverted: it would weaken the tested IPC boundary.)
- Bundles are served by the crew server (stored in Postgres) rather than downloaded from GitHub by machines.
- Certificate committed as `.crt` because `*.pem` is gitignored.
- Local signing was not exercised end to end on the owner's keychain (prompt, see step 2); signing with the same
  certificate was verified in a throwaway keychain, and CI verifies each release.
- `pnpm dev` now runs `build:app` first (the host is no longer built by the dev server).

## Left undone

- A full `package:mac` run was not done locally (heavy, and it would hit the keychain prompt); the first CI
  release on a `v0.3.0` tag is the end-to-end check of signing.
- Nothing else. Docs (written by a sonnet subagent, spot-checked): new `docs/flows/runtime-updates.md`; updated
  `desktop-app`, `desktop-ui`, `api-platform`, `machine-pairing`, `project-claims`, `daemon-api`,
  `event-delivery`, `daemon-runtime`, `daemon-scheduling`, `web-admin`, `web-shell`, `deployment` and
  `docs/architecture.md`; `docs/flows.yaml` (flows section only) and generated `docs/index.md`/`docs/files.md`.
  On a temporary index built from HEAD + this change, `crew-docs check --staged` and `--commit-msg` (no trailer)
  pass, `check --all` passes, and no R6-protected path is touched.
