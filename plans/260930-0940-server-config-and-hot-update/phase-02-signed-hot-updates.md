---
title: "Phase 2: Signed hot updates"
status: todo
priority: P1
effort: 12h
dependsOn: [1]
---

# Phase 2: Signed hot updates

## Idea

Split the desktop app into a rarely changing **shell** (Electron binary, preload, native modules: better-sqlite3, the
Agent SDK platform binary, MCP SDK, electron-updater) and a **runtime bundle** (main-process app logic where feasible,
the daemon host with the bundled daemon library, the role prompt defaults, and the renderer). The shell loads the newest
verified runtime bundle from `~/.crew/runtime/<version>/`, else the one it ships with. Updating the bundle does not
change the app binary, so macOS does not ask for Documents access again.

## Requirements

- **Bundle format**: a tarball plus `manifest.json` (version, git commit, created_at, sha256 of every file,
  `shellRange` — the shell versions and native ABI it needs) and a detached **Ed25519 signature** over the manifest.
- **Signing**: CI signs with a private key kept only in a GitHub Actions secret; the public key is embedded in the shell.
  The shell refuses a bundle whose signature, file hashes or `shellRange` do not match. Key rotation: the shell accepts a
  small list of public keys. Document how to generate the key and add the secret; until the owner adds it, CI builds
  unsigned bundles that the shell refuses (no silent unsigned path).
- **Distribution**: CI publishes the bundle to GitHub Releases (tag `runtime-v<version>`), and the crew server exposes
  `GET /v1/runtime/latest` (and the desired version per machine) so the owner controls rollout.
- **Update flow on the machine**: check on start, on a `runtime.published` event and hourly; download; verify; unpack to
  `~/.crew/runtime/<version>/`; when no job is mid-tool-call or at most after a graceful daemon stop (jobs resume as with
  today's restart), restart the daemon host (and reload the renderer) on the new bundle. The Electron main process
  restarts only if the bundle includes main-process code and nothing is running.
- **Rollback**: keep the previous two bundles. If the new bundle's host is not ready within the supervisor timeout twice,
  or crashes repeatedly within 5 minutes, switch back to the previous bundle and report it. The owner can pin or roll back
  a machine from the web; the web Machines page shows each machine's shell version, runtime version and update state.
- **Shell updates** (native module or Electron change) remain a dmg install; the runtime manifest's `shellRange` tells the
  app to ask for it.
- **Security**: never execute a bundle before verification; unpack with path-traversal checks; the runtime dir is owned by
  the user with 0700; no code is downloaded from anywhere but the configured sources.
- Tests: signing/verification (good, bad signature, tampered file, wrong shellRange, path traversal), update state
  machine, rollback on failed boot, E2E: publish a signed test bundle to a test server → running app switches without
  reinstall.

## Scope extension (owner, 2026-09-30): ask for OS permissions once

Owner: "gom thành quyền lớn hỏi 1 lần; spam hỏi quyền nhiều quá". macOS binds privacy (TCC) grants to the app's code
signature; an ad-hoc signature changes on every build, so every update re-prompts.

- **Stable signing identity:** CI signs every app build with the same self-signed code-signing certificate (free; no
  Apple Developer account). The certificate and its private key live only in GitHub Actions secrets (p12 + password);
  document generating it (`security`/`openssl`), adding the secrets, and verifying the designated requirement
  (`codesign -d -r-`) is anchored to the certificate, not just the bundle identifier. Local packaging uses the same
  certificate when present in the login keychain, else stays ad-hoc with a clear warning. Gatekeeper still needs
  "Open Anyway" on the first install (not notarized).
- **Full Disk Access once:** the gateway app's setup and status view check whether Full Disk Access is granted (e.g. by
  probing a protected path such as `~/Library/Safari` or the TCC database read, without prompting), and if not, explain
  in Vietnamese and open System Settings → Privacy & Security → Full Disk Access with one button
  (`x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles`). Once granted, no per-folder prompts.
  Folder-access waiting logic stays as a fallback.
- **With hot updates (this phase)** most updates don't change the binary at all; with the stable identity even shell
  updates keep the grants.
- Tests: FDA detection unit (mocked probes), signing verification script in CI (designated requirement contains the
  certificate's leaf hash).
