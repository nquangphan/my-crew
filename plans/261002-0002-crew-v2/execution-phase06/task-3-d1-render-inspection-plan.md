# T3 D1 — BMAD render artifact byte-inspection plan

> **For agentic workers:** Use the approved Superpowers execution workflow and track each checkbox. This plan is a scoped proposal; PM source release is required before implementation.

**Goal:** Check one already-supplied BMAD render generation's bytes against an immutable expected identity, without enabling BMAD admission.

**Architecture:** A synchronous, pure inspection kernel captures expected project, pin, file-hash and layer-hash values in a factory. `inspect()` accepts a finite byte snapshot supplied by a future trusted reader. It parses the official manifest and compares source, renderer, output and current raw config bytes. It never reads a filesystem path, invokes the renderer, or emits a runtime receipt.

**Tech Stack:** TypeScript 7.0.2, Node ≥24.12 `node:test` and crypto, existing pin types; no dependency or native helper.

**Spec:** Approved phase06 `task-3-brief.md` T3; `task-3-next-slice-preflight.md`; pinned BMAD 6.12.0 archive SHA-256 `ac05c93f0b3c4256bb4072e6e1ff181eaad6cc0a64a27a63893bfb2b0b64aed2`.

## Exact official format evidence

- Read-only `tar -xOzf` of that hash-checked archive, `package/src/scripts/render_skill.py`: lines 40–43 use Python `json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")`; lines 345–376 construct source hashes, identity, directory and manifest.
- Line 347 makes the **manifest `root_hash` field itself 12 hex digits**: SHA-256 of the UTF-8 absolute project-root string, sliced to 12. Lines 357 and 363–364 make `generation_hash` 20 hex digits and use both truncated fields in the destination path. No full-hash `root_hash` field exists.
- Manifest schema is 1; keys are `schema_version`, `skill`, `project_root`, `project_slug`, `root_hash`, `generation_hash`, `inputs`, `outputs`. `inputs` has `project_root`, `renderer_sha256`, `resolved_values`, `source_sha256`; `outputs` maps source-relative `.md` names to SHA-256 strings.
- Lines 98–115 recursively load all skill `.md` except `SKILL.md` and require `workflow.md`; lines 232–267 replace only tokens authored in those sources. Manifest and output consistency alone do not prove this renderer ran.

## Global constraints and review focus

- Only proposed new files after PM grant: `v2/gateway/src/assistant/render-artifacts.ts` and `v2/gateway/test/render-artifacts.test.ts`. No frozen manifest, host, registry, builder, workspace, server, SQL, app, package or docs-manifest edit by this worker. PM alone reviews/commits.
- No D1 filesystem reader, dirfd/openat, native execution, uv, renderer, DB, provider or network. Node `fs` lacks a reviewed no-follow directory-FD traversal here; pathname `lstat` then reopen cannot prove malicious ABA safety.
- A fake byte supplier may establish parser behavior only. It cannot certify root confinement, regular-file type, symlink/FIFO avoidance, execution once/STOP, official stdout, durable handoff, or operational project-root mapping. These remain separately reviewed producer/reader gates.
- `loadDefinition(source, projection)` must continue to reject BMAD with `RENDER_ARTIFACT_REQUIRED`. No D1 type or field named `verified`, `receipt`, `certificate`, `executedOnce`, `trustedReader`, or production-ready authority.
- Caller mutation of nested expected pins/layers or supplied byte arrays must not change an inspection already in progress; the factory snapshots expected values and `inspect()` copies its finite byte bundle before validation.
- A changed optional layer is rejected even if all `resolved_values` and output bytes remain equal. Source/renderer/output/manifest changes, malformed paths and generation mismatch are rejected. The pure kernel does not claim filesystem drift detection across time.
- A source omitted from both the expected selected-file map and supplied byte bundle is invisible to D1. The future registry/reader composition must prove completeness against the pinned projection manifest.
- An absolute, normalized `projectRoot` or `generationPath` string is only lexical evidence in D1; no `realpath`, directory identity or live checkout equivalence is implied.
- The returned object may be logged as inspection data, but no future consumer may treat its presence as authorization without the independent producer and handoff gates below.

---

### Task 1: Pure supplied-byte inspection kernel

**Files:** Create `v2/gateway/src/assistant/render-artifacts.ts`; test `v2/gateway/test/render-artifacts.test.ts`.

**Proposed types:**

```ts
type LayerPath = /* exact seven literal paths below */ string;
type CapturedExpectation = {
  projectRoot: string; generationRoot: string;
  source: SourcePin; projection: ProjectionPin; // identity labels, not D1 pin proof
  selectedProjectionSha256: Readonly<Record<string, string>>;
  layers: Readonly<Record<LayerPath, string | null>>; // null = expected absent
};
type ArtifactByteSnapshot = {
  generationPath: string; // supplier claim; D1 compares strings, not realpath
  projectedFiles: Readonly<Record<string, Uint8Array>>;
  layerFiles: Readonly<Record<LayerPath, Uint8Array | null>>;
  manifestBytes: Uint8Array;
  outputBytes: Readonly<Record<string, Uint8Array>>;
};
type ArtifactInspection = {
  kind: 'artifact-inspection'; manifestSha256: string;
  sourceSha256: Readonly<Record<string, string>>;
  outputSha256: Readonly<Record<string, string>>;
  layerSha256: Readonly<Record<LayerPath, string | null>>;
};
declare function createBmadArtifactInspector(expected: CapturedExpectation):
  { inspect(snapshot: ArtifactByteSnapshot): ArtifactInspection };
```

The seven layer paths are required `_bmad/config.toml` and `.claude/skills/bmad-build/customize.toml`; optional `_bmad/config.user.toml`, `_bmad/custom/config.toml`, `_bmad/custom/config.user.toml`, `_bmad/custom/bmad-build.toml`, `_bmad/custom/bmad-build.user.toml`. `selectedProjectionSha256` must cover all selected skill `.md` files plus `customize.toml`, `_bmad/scripts/render_skill.py` and `_bmad/scripts/config_utils.py`. Future host code must derive this expected map from a separately verified registry resolution; D1 cannot establish that derivation from caller-supplied fields.

- [ ] **Step 1: Author meaningful RED.** A unit-only fixture injects UTF-8 `.md` source bytes, exact seven layer states, renderer/config helper bytes, schema-1 manifest bytes and output bytes using the official identity/path algorithm. Its expected hashes are measured from those fixture bytes, never placeholder digests. Assert a positive result is only `kind:'artifact-inspection'`, and the frozen BMAD manifest adapter still denies. A minimal deny scaffold may be added solely so tests load; import/setup/compiler failure is not behavioral RED.
- [ ] **Step 2: Negative RED matrix.** Mutate original expected `projection.derivation.options`, selected-hash map and nested layer map after factory construction; mutate supplied `Uint8Array` values after inspection and confirm the result is stable. Reject present↔absent optional layers, equal-token config byte drift, wrong/extra/missing layer keys, wrong script or source bytes, wrong output digest/key set, schema/key shape errors, unexpected/unsafe POSIX names, absent `workflow.md`, wrong project root/slug/root hash/generation hash/path and undeclared snapshot target.
- [ ] **Step 3: Distinguish fixture provenance.** The D1 positive fixture is **unit-injected** and proves only inspection math. During static review, compare its schema algorithm to the exact archived `render_skill.py` lines above. A later separately authorized bounded development integration may install the pinned archive and run its official script in an owned root; that still does not prove production root equivalence or authorize an adapter.
- [ ] **Step 4: Observe RED under PM heavy slot.** With fresh pressure/available-memory/idle/disk gate, run `NODE_OPTIONS=--max-old-space-size=384 node --test --test-name-pattern='render artifact inspection' test/render-artifacts.test.ts` from `v2/gateway`. Preserve source/test hashes, raw exit/log and owned scratch cleanup, then release the slot before feature code. No FIFO/native/renderer process belongs to this D1 test.
- [ ] **Step 5: Implement pure checks.** Clone and validate captured expectation before returning the inspector; clone and cap every supplied byte array at inspection entry. Enforce exact field/key sets, normalized lexical POSIX names, no alias/traversal/absolute paths, required file/layer presence, SHA-256 of selected projected files and layers, 1 MiB manifest and 32 MiB total selected/output bytes. This bounds CPU/memory over supplied bytes; a future reader must separately bound real reads and reject symlink/FIFO/nonregular files.
- [ ] **Step 6: Match official generation geometry.** Compute source hashes from selected skill `.md` bytes except `SKILL.md`; require `workflow.md` and matching manifest `inputs.source_sha256`. Compare manifest `inputs.renderer_sha256` to supplied renderer bytes. Require exact source/output key sets and hash every supplied output. Recompute root slug (lowercase, non-alphanumeric runs to `-`, trim, 80-character cap), `root_hash=sha256(UTF8(projectRoot)).slice(0,12)`, `generation_hash=sha256(Python-canonical-JSON(inputs)).slice(0,20)` and the expected destination string. Test canonicalization with an exact Python-format Unicode/control vector; reject malformed Unicode.
- [ ] **Step 7: Preserve limits of `resolved_values`.** Validate JSON shape and source-authored snapshot targets, then include `resolved_values` in generation-hash calculation. D1 cannot establish that those values came from current TOML semantics or that outputs arose from official token substitution. Raw layer bytes are compared to captured SHA-256 separately; no token equality may mask raw configuration drift.
- [ ] **Step 8: Verify/review.** After a separate PM heavy grant, run affected tests, gateway typecheck and scoped Biome; repeat after any final edit. Report exact counts, source/log hashes and scratch cleanup. PM independently reviews before any host reader, executor or adapter consumption.

## Deferred producer gates

- A trusted host must resolve source/projection pins, capture immutable expected project/checkout/run context, derive the selected projection hashes, and provide a reviewed no-follow, nonblocking, bounded reader that samples current layers and files under an owned render root. A unit byte bundle is not a secure reader.
- A separately reviewed executor must materialize the operational `{project-root}` correctly and run the official `uv run --no-cache` renderer once, honor HALT/exit/stdout and bind that operation to the inspected generation. D1 neither runs it nor fabricates an execution witness.
- Durable authenticated gateway→server artifact/definition handoff, persisted Actor A/G1 orchestration, source-derived run graph, real artifact gates and SQL011 authority remain later work. D1 never enables BMAD `loadDefinition` or positive `createRun`.
